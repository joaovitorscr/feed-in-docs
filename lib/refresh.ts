import { BlobPreconditionFailedError } from "@vercel/blob";

import { MAX_DURATION_MS, RUN_BUDGET_MS, SAVE_BUDGET_MS } from "@/lib/limits";
import { generateAndSave, type LinkRecord, readRecord, sameEtag, writeRecord } from "@/lib/links";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Attempts after which a link stops refreshing until it's submitted again. */
const MAX_FAILURES = 3;

/** Test switches, honored everywhere but production. */
function testSwitches() {
  if (process.env.VERCEL_ENV === "production") return { seconds: null, fail: null };
  const seconds = Number(process.env.LINK_REFRESH_TEST_SECONDS);
  const fail = process.env.LINK_REFRESH_TEST_FAIL;
  return {
    seconds: seconds > 0 ? seconds * 1000 : null,
    fail: fail === "run" || fail === "record" ? fail : null,
  } as const;
}

/** Every timing refresh uses. `LINK_REFRESH_TEST_SECONDS` replaces each one, outside production. */
function refreshLimits() {
  const test = testSwitches().seconds;
  return {
    /** A read schedules a check only when the text is older than this. */
    gateMs: test ?? DAY,
    /** A copy is stale after this long, by mode. A published file is one or two small fetches. */
    staleMs: { published: test ?? DAY, crawled: test ?? 7 * DAY },
    /** Never under `maxDuration`, so a lock is never taken over while its run is still alive. */
    backoffMs: Math.max(test ?? DAY, MAX_DURATION_MS),
    /** How long one instance waits before checking the same link again. */
    memoMs: Math.min(10 * MINUTE, test ?? Infinity),
  };
}

/** When this instance last scheduled a check, by link ID. */
const lastChecked = new Map<string, number>();

/**
 * Whether a read of a link uploaded at `uploadedAt` should schedule a check: the text is past the
 * read gate, and this instance hasn't checked the link within the memo window. Claims the window
 * when it returns true.
 */
export function shouldCheck(id: string, uploadedAt: Date | null, now = Date.now()) {
  const { gateMs, memoMs } = refreshLimits();
  if (!uploadedAt || now - uploadedAt.getTime() < gateMs) return false;
  const last = lastChecked.get(id);
  if (last !== undefined && now - last < memoMs) return false;
  if (lastChecked.size >= 1000) {
    for (const [key, at] of lastChecked) if (now - at >= memoMs) lastChecked.delete(key);
  }
  lastChecked.set(id, now);
  return true;
}

/** Why a check stops before the lock, or `null` when the link is due for a refresh. */
function skipReason(record: LinkRecord, servedEtag: string, now: number) {
  const { staleMs, backoffMs } = refreshLimits();
  if (!sameEtag(record.textEtag, servedEtag)) return "record-mismatch";
  if (now - Date.parse(record.generatedAt) < staleMs[record.mode]) return "fresh";
  if (record.refreshStartedAt && now - Date.parse(record.refreshStartedAt) < backoffMs) {
    return "backoff";
  }
  if ((record.refreshFailures ?? 0) >= MAX_FAILURES) return "stopped";
  return null;
}

/**
 * Checks a link after a read served it, and refreshes it when it's stale. Run it in `after()`:
 * `servedEtag` is the ETag of the text the read served, and `requestStart` is when the request
 * began, since the invocation's deadline counts from there. Logs `refresh-start` only after
 * winning the lock, then `refresh-end` with the outcome.
 */
export async function checkLink(id: string, servedEtag: string, requestStart: number) {
  const deadlineAt = requestStart + MAX_DURATION_MS - 5_000;
  const deadline = AbortSignal.timeout(Math.max(0, deadlineAt - Date.now()));
  const { fail } = testSwitches();

  // Before the run: the record read and the lock share one storage budget.
  const beforeRun = AbortSignal.any([deadline, AbortSignal.timeout(SAVE_BUDGET_MS)]);
  let saved: Awaited<ReturnType<typeof readRecord>>;
  try {
    saved = await readRecord(id, beforeRun);
  } catch (error) {
    console.error(`refresh-skip ${id} record-unreadable`, error);
    return;
  }
  if (!saved) return console.log(`refresh-skip ${id} no-record`);
  const { record, etag } = saved;
  const startedAt = Date.now();
  const reason = skipReason(record, servedEtag, startedAt);
  if (reason) return console.log(`refresh-skip ${id} ${reason}`);

  // The lock counts the attempt, so a run that never finishes, whatever stops it, still counts.
  const attempt = (record.refreshFailures ?? 0) + 1;
  let lockEtag: string;
  try {
    lockEtag = await writeRecord(
      id,
      { ...record, refreshStartedAt: new Date(startedAt).toISOString(), refreshFailures: attempt },
      beforeRun,
      etag,
    );
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      return console.log(`refresh-skip ${id} lost-lock`);
    }
    console.error(`refresh-skip ${id} lock-failed`, error);
    return;
  }
  console.log(`refresh-start ${id} attempt ${attempt} ${record.request} ${record.source}`);

  // The run leaves SAVE_BUDGET_MS before the deadline, and the writes get their own fresh budget.
  const runStart = Date.now();
  const budgetMs = Math.min(RUN_BUDGET_MS - SAVE_BUDGET_MS, deadlineAt - SAVE_BUDGET_MS - runStart);
  const took = () => `${((Date.now() - runStart) / 1000).toFixed(1)}s`;
  try {
    if (budgetMs <= 0) throw new Error("No time left for the run");
    const outcome = await generateAndSave(record.source, record.request, {
      budgetMs,
      storage: () => AbortSignal.any([deadline, AbortSignal.timeout(SAVE_BUDGET_MS)]),
      reject: (result) => {
        if (result.truncated && !record.truncated) return "newly-truncated";
        if (result.count * 2 < record.count) return `shrank ${record.count}->${result.count}`;
        return null;
      },
      ifMatch: { text: record.textEtag, record: lockEtag },
      fail,
    });
    if (outcome.status === "rejected") {
      return console.log(`refresh-end ${id} rejected ${outcome.reason} ${took()}`);
    }
    if (!outcome.id) return console.log(`refresh-end ${id} error text-not-saved ${took()}`);
    const { count, truncated } = outcome.result;
    const detail = `count ${count} truncated ${truncated} record ${outcome.recordSaved ? "saved" : "not-saved"}`;
    console.log(`refresh-end ${id} accepted ${detail} ${took()}`);
  } catch (error) {
    console.log(
      `refresh-end ${id} error ${error instanceof Error ? error.message : error} ${took()}`,
    );
  }
}
