import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

const ID_PATTERN = /^[a-f0-9]{16}$/;

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
};

/** The generate result fields the record keeps, plus the text it saves. */
type SavedResult = Omit<LinkRecord, "generatedAt" | "textEtag"> & { text: string };

/**
 * Saves the index under an ID derived from its source, so regenerating refreshes the same link,
 * then writes its record. `signal` bounds both uploads; when the text upload fails or aborts, the
 * result has no link. A failed record write still returns the link, which only loses refresh.
 */
export async function saveLlmsTxt({ text, ...result }: SavedResult, signal: AbortSignal) {
  const generatedAt = new Date().toISOString();
  const id = createHash("sha256").update(result.source).digest("hex").slice(0, 16);
  let textEtag: string;
  try {
    ({ etag: textEtag } = await put(textPath(id), text, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "text/plain; charset=utf-8",
      abortSignal: signal,
    }));
  } catch (error) {
    // The generated text is still usable, so a storage failure only costs the link.
    console.error("Could not save llms.txt", error);
    return null;
  }
  const record: LinkRecord = {
    source: result.source,
    request: result.request,
    mode: result.mode,
    filtered: result.filtered,
    count: result.count,
    truncated: result.truncated,
    generatedAt,
    textEtag,
  };
  try {
    await put(recordPath(id), JSON.stringify(record), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/json",
      abortSignal: signal,
    });
  } catch (error) {
    console.error("Could not save the llms.txt record", error);
  }
  return id;
}

/**
 * Reads a saved index. `uploadedAt` is when its text was written, or `null` when storage didn't
 * say (the Blob SDK would otherwise report the time of the read). `blob` carries the `etag`.
 */
export async function readLlmsTxt(id: string) {
  if (!ID_PATTERN.test(id)) return null;
  const result = await get(textPath(id), { access: "private" });
  if (result?.statusCode !== 200) return null;
  const { stream, blob, headers } = result;
  return { stream, blob, uploadedAt: headers.has("last-modified") ? blob.uploadedAt : null };
}
