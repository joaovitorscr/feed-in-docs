import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

import { generateLlmsTxt } from "@/lib/generate";

const ID_PATTERN = /^[a-f0-9]{16}$/;

/** Just under Vercel's 4.5 MB function response limit, with headroom for the link. */
const MAX_RESPONSE_BYTES = 4_400_000;

function textPath(id: string) {
  return `llms/${id}.txt`;
}

function recordPath(id: string) {
  return `llms/${id}.json`;
}

/** What a saved link was made from, kept next to its text so a refresh can rerun it. */
export type LinkRecord = {
  /** The URL as typed, which is also what the ID hashes. */
  source: string;
  /** What was asked for: `"crawl"` when the request sent `crawl: true`, `"auto"` otherwise. */
  request: "auto" | "crawl";
  mode: "published" | "crawled";
  filtered: boolean;
  count: number;
  truncated: boolean;
  /** When the run that made the text finished, as an ISO timestamp. */
  generatedAt: string;
  /** The ETag the text `put` returned, so a reader can tell whether the record still describes the text. */
  textEtag: string;
  /** When the refresh that holds the lock started, as an ISO timestamp. Absent when none has. */
  refreshStartedAt?: string;
  /** Refresh attempts since the last good copy. Records saved before refresh existed lack it, which counts as 0. */
  refreshFailures?: number;
};

type GenerateResult = Awaited<ReturnType<typeof generateLlmsTxt>>;

type SaveOptions = {
  /** The run's budget. The POST route uses `generateLlmsTxt`'s default. */
  budgetMs?: number;
  /** Makes the signal for both writes. Called when the run ends, so a long run can't eat into it. */
  storage: () => AbortSignal;
  /** Returns why the run's result must not replace the saved copy, or `null` to save it. */
  reject?: (result: GenerateResult) => string | null;
  /** Conditional writes: the text only over this text ETag, the record only over this record ETag. */
  ifMatch?: { text: string; record: string };
  /** Test-only failures, from `LINK_REFRESH_TEST_FAIL`: the run, or the record write, throws. */
  fail?: "run" | "record" | null;
};

/**
 * Generates the index for `input`, checks its size, then saves the text under an ID derived from
 * its source and writes its record. The POST route and the background refresh both use it.
 *
 * - `rejected` with reason `too-large` when the response would pass Vercel's limit. Without
 *   `reject` and `ifMatch`, that's the only rejection.
 * - `rejected` with reason `text-changed` when `ifMatch.text` no longer matches: a manual submit
 *   replaced the text first, so nothing is written.
 * - `saved` with `id: null` when the text write failed: the text is still usable, only the link is
 *   lost. With `recordSaved: false`, the link works but has no matching record, which only loses
 *   refresh.
 *
 * A failed run throws.
 */
export async function generateAndSave(
  input: string,
  request: LinkRecord["request"],
  { budgetMs, storage, reject, ifMatch, fail }: SaveOptions,
) {
  if (fail === "run") throw new Error("LINK_REFRESH_TEST_FAIL=run");
  const result = await generateLlmsTxt(input, { budgetMs, crawl: request === "crawl" });
  const generatedAt = new Date().toISOString();
  const { text, source, ...response } = result;
  // Measured on the response body, where JSON escaping makes the text longer.
  if (Buffer.byteLength(JSON.stringify({ text, ...response, link: null })) > MAX_RESPONSE_BYTES) {
    return { status: "rejected", reason: "too-large" } as const;
  }
  const reason = reject?.(result);
  if (reason) return { status: "rejected", reason } as const;

  const signal = storage();
  const id = createHash("sha256").update(source).digest("hex").slice(0, 16);
  let textEtag: string;
  try {
    ({ etag: textEtag } = await put(textPath(id), text, {
      access: "private",
      allowOverwrite: true,
      ...(ifMatch && { ifMatch: ifMatch.text }),
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      contentType: "text/plain; charset=utf-8",
      abortSignal: signal,
    }));
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      return { status: "rejected", reason: "text-changed" } as const;
    }
    // The generated text is still usable, so a storage failure only costs the link.
    console.error("Could not save llms.txt", error);
    return { status: "saved", result, id: null, recordSaved: false } as const;
  }
  const record: LinkRecord = {
    source,
    request,
    mode: result.mode,
    filtered: result.filtered,
    count: result.count,
    truncated: result.truncated,
    generatedAt,
    textEtag,
    refreshFailures: 0,
  };
  try {
    if (fail === "record") throw new Error("LINK_REFRESH_TEST_FAIL=record");
    await writeRecord(id, record, signal, ifMatch?.record);
  } catch (error) {
    console.error("Could not save the llms.txt record", error);
    return { status: "saved", result, id, recordSaved: false } as const;
  }
  return { status: "saved", result, id, recordSaved: true } as const;
}

/**
 * Writes a link's record and returns its new ETag. With `ifMatch`, the write happens only over that
 * record version and throws `BlobPreconditionFailedError` otherwise.
 */
export async function writeRecord(
  id: string,
  record: LinkRecord,
  signal: AbortSignal,
  ifMatch?: string,
) {
  const { etag } = await put(recordPath(id), JSON.stringify(record), {
    access: "private",
    allowOverwrite: true,
    ...(ifMatch && { ifMatch }),
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
    abortSignal: signal,
  });
  return etag;
}

/**
 * Reads a link's record from origin storage, or `null` when it has none. `etag` is strong, ready
 * for `writeRecord`'s `ifMatch`.
 */
export async function readRecord(id: string, signal: AbortSignal) {
  const result = await get(recordPath(id), {
    access: "private",
    useCache: false,
    abortSignal: signal,
  });
  if (result?.statusCode !== 200) return null;
  const record: LinkRecord = await new Response(result.stream).json();
  return { record, etag: strongEtag(result.blob.etag) };
}

/**
 * An ETag without the weak mark. `put()` and `head()` return a strong ETag, and `get()` returns
 * the same value marked weak (`W/"…"`). `ifMatch` needs the strong form.
 */
function strongEtag(etag: string) {
  return etag.replace(/^W\//, "");
}

/**
 * Whether two ETags name the same blob version. Compare a record's `textEtag` with a read's
 * `blob.etag` through this, never with `===`.
 */
export function sameEtag(a: string, b: string) {
  return strongEtag(a) === strongEtag(b);
}

/**
 * Reads a saved index from origin storage. The Blob CDN reports when it cached the file as
 * `last-modified`, so a cached read would lie about the link's age. `uploadedAt` is when its
 * text was written, or `null` when storage didn't say (the Blob SDK would otherwise report the
 * time of the read). `blob` carries the `etag`; compare it with `sameEtag`.
 */
export async function readLlmsTxt(id: string) {
  if (!ID_PATTERN.test(id)) return null;
  const result = await get(textPath(id), { access: "private", useCache: false });
  if (result?.statusCode !== 200) return null;
  const { stream, blob, headers } = result;
  return { stream, blob, uploadedAt: headers.has("last-modified") ? blob.uploadedAt : null };
}
