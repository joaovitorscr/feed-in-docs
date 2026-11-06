# Saved links

`lib/links.ts` saves each result and reads it back, and `lib/refresh.ts` refreshes stale links in the background. `app/api/generate/route.ts` saves, and `app/l/[id]/llms.txt/route.ts` serves and schedules refreshes.

**One save path.** `generateAndSave` in `lib/links.ts` covers generate, the response-size check, and writing the text and the record. The POST route and the refresh both call it, and the refresh adds its acceptance rule and conditional writes as options.

## IDs

The ID is the first 16 hex characters of the SHA-256 of `source`, the URL as typed, before any redirect. Generating the same URL again overwrites the same link. The ID can't be reversed, so the record below is the only place the source is kept.

## Blobs

Each link is two private blobs, written in this order:

1. **`llms/{id}.txt`**, the text, with `cacheControlMaxAge: 60`.
2. **`llms/{id}.json`**, the record, written only after the text `put` succeeds.

A submit's writes are unconditional overwrites (`allowOverwrite: true`), so a manual submit always replaces the text and the record. A refresh's writes are conditional (`ifMatch`, see Refresh). A submit's writes take the request's one storage deadline (`SAVE_BUDGET_MS`, see `crawler.md`). A failed or timed-out text `put` gives `link: null`. A failed or timed-out record `put` is logged as "Could not save the llms.txt record", and the response keeps its link. The link then works with no record, like an older link.

The record is a separate blob, not a JSON envelope around the text, so a read streams the text without parsing up to 4.4 MB of JSON, and links saved before records existed need no fallback.

## The record

```json
{
  "source": "https://nextjs.org/docs",
  "request": "auto",
  "mode": "published",
  "filtered": false,
  "count": 299,
  "truncated": false,
  "generatedAt": "2026-11-06T15:29:25.130Z",
  "textEtag": "\"…\"",
  "refreshFailures": 0
}
```

- **`source`** is the URL as typed, the one the ID hashes.
- **`request`** is what was asked for: `"crawl"` when the POST sent `crawl: true`, `"auto"` otherwise. A rerun with the same `source` and `request` repeats the request, so a choice to crawl is never undone.
- **`mode`**, **`filtered`**, **`count`** and **`truncated`** are copied from the generate result.
- **`generatedAt`** is when the run finished, just before the text `put`.
- **`textEtag`** is the `etag` the text `put` returned. When it differs from the text blob's current ETag, the record no longer describes the text: either the record write failed after a text write, or a later write replaced the text.

**Comparing ETags.** `put()` and `head()` return a strong ETag (`"bd8b…"`), and `get()` returns the same value marked weak (`W/"bd8b…"`), with or without the CDN. So `textEtag` never equals a read's `blob.etag` with `===`. Compare them with `sameEtag(a, b)` from `lib/links.ts`, which strips a leading `W/` from both. The record keeps the strong ETag, because `ifMatch` needs it.

- **`refreshStartedAt`** is set by a refresh's lock, and cleared when the refresh is accepted. A submit writes no `refreshStartedAt`.
- **`refreshFailures`** counts refresh attempts since the last good copy. A submit and an accepted refresh write `0`. Records saved before refresh existed lack it, which counts as `0`.

`scope` and `publishedUrl` are left out. A refresh reruns from `source` and `request` and gets them again.

## Serving

`readLlmsTxt` makes one `get` for the text, with `useCache: false`, and returns its stream, its `blob` (with `etag`) and `uploadedAt`. The route sends `Last-Modified` from `uploadedAt`, so a link shows its true age without a second Blob call. The read doesn't touch the record.

- **Why origin, not the Blob CDN.** The SDK fills `uploadedAt` from the response's `last-modified` header. Through the Blob CDN, that header is when the CDN cached the file, not when it was uploaded, so a cached read reports a link as minutes old however old it is. From origin it equals `head().uploadedAt`. An origin read took 156–186 ms against 22–84 ms through the CDN when measured (5 reads each).
- **No header.** When `last-modified` is missing, the SDK reports the time of the read, so `readLlmsTxt` returns `uploadedAt: null`, and the route sends no `Last-Modified`.

Responses carry `Cache-Control: public, max-age=60, s-maxage=60`, so the route only reads origin on a cache miss, and a CDN hit can be up to a minute old.

## Links without a record

Links saved before records existed have only the text. They serve exactly as before, with `Last-Modified` added, and refresh only when the same URL is submitted again.

## Refresh

A read of a stale link serves the text it has, then refreshes the link in `after()`, for later reads. There's no cron and no queue: only links still being read refresh.

### Limits

|                                                                   | Default    | With `LINK_REFRESH_TEST_SECONDS`                    |
| ----------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| Read gate: a read schedules a check only for text older than this | 1 day      | the override                                        |
| Stale, `mode: "published"` (one or two small fetches)             | 1 day      | the override                                        |
| Stale, `mode: "crawled"`                                          | 7 days     | the override                                        |
| Backoff after an attempt                                          | 24 h       | the override, but never under `maxDuration` (300 s) |
| Per-instance memo                                                 | 10 minutes | the shorter of 10 minutes and the override          |
| Attempts before the link stops refreshing                         | 3          | 3                                                   |

The backoff never drops below `maxDuration`, so a lock is never taken over while its run can still be alive.

**Test switches.** Outside production (`VERCEL_ENV !== "production"`), `LINK_REFRESH_TEST_SECONDS` replaces the timings above, and `LINK_REFRESH_TEST_FAIL` forces failures: `run` makes the rerun throw, and `record` makes the refresh's final record write throw. Production ignores both. A submit never reads `LINK_REFRESH_TEST_FAIL`.

### Serving a read

`app/l/[id]/llms.txt/route.ts` serves the text as before, then schedules `checkLink` in `after()` when both hold:

- `uploadedAt` is older than the read gate;
- this instance hasn't scheduled a check for this ID within the memo window (an in-memory `Map`, `shouldCheck` in `lib/refresh.ts`).

The route exports `maxDuration = 300` as a literal, the same as the POST route, because `after()` runs under the route's limit. Normal reads still take milliseconds.

**Blob calls per read:**

- **Under a day old:** one call, the text `get`.
- **Older:** one more call, the record `get`, at most once per instance per 10 minutes. That covers crawled copies between 1 and 7 days old, links without a record, and links stopped after 3 failures.
- **CDN hits** (`s-maxage=60`) never reach the route.

### Check and refresh

`checkLink(id, servedEtag, requestStart)` in `lib/refresh.ts`:

1. **Read** the record with `get(…, { useCache: false })`. Stop, logging `refresh-skip {id} {reason}`, if:
   - there's no record (`no-record`);
   - its `textEtag` differs from the ETag of the text the read just served, compared with `sameEtag` (`record-mismatch`). Either the record write failed after a text write, or a submit replaced the text;
   - `generatedAt` is within this mode's stale limit (`fresh`);
   - `refreshStartedAt` is within the backoff (`backoff`);
   - `refreshFailures` is 3 or more (`stopped`).
2. **Lock and count the attempt.** Write the record with `refreshStartedAt: now` and `refreshFailures + 1`, with `ifMatch` set to the record's ETag (strong, with `W/` stripped). A lost race gets a 412 and stops (`lost-lock`). Only the winner logs `refresh-start {id}` and keeps the new record ETag, `lockEtag`. A refresh killed by `maxDuration` or out of memory has already counted itself.
3. **Rerun** `source` with the same `request`, so a choice to crawl is never undone.
4. **Accept** the new copy only if the run succeeded, fits the response-size limit, isn't newly truncated (`truncated` when the old copy wasn't), and has a `count` at least half the old one.
5. **On accept**, write the text with `ifMatch: record.textEtag`. A 412 means a submit replaced the text first, so stop (`rejected text-changed`). Then write the record with `ifMatch: lockEtag`: the new `textEtag` and `generatedAt`, no `refreshStartedAt`, and `refreshFailures: 0`. If only that record write fails, the record keeps the lock's count and backoff. Blob ETags are content hashes, so what follows depends on the text:
   - **The text changed.** The record's `textEtag` no longer matches, and step 1 skips the link with `record-mismatch` until the next submit.
   - **The text is byte-identical.** Its ETag is unchanged, so the record still matches. The link retries after each backoff and stops after 3 attempts, still serving correct text.
6. **On reject or error**, nothing more is written. The count and backoff from step 2 already apply.
7. **Log** `refresh-end {id} accepted|rejected|error`, with the reason or the new count, and how long the run took.

**Manual submits always win.** The POST route writes the text and the record unconditionally, with `refreshFailures: 0` and no `refreshStartedAt`. A submit during a refresh makes the refresh's conditional text write fail, so the submit's text and record survive. The exception is a submit whose text is byte-identical to the old copy: its ETag is unchanged, so the refresh's text write lands and only its record write fails. Submitting again is how to refresh shrunken docs, restart a stopped link, or repair a record that no longer matches. If two submits race, the record and the text may disagree, and step 1 skips refreshes until the next submit.

### Time budget

Everything runs inside `after()`, under the route's `maxDuration` (300 s).

| Phase                                       | Limit                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absolute deadline                           | `maxDuration` − 5 s, from the start of the request. Every Blob call below is also bound to it with `AbortSignal.any`.                                                 |
| Before the run: record `get` and lock `put` | one `SAVE_BUDGET_MS` (20 s) signal, started when the check begins                                                                                                     |
| The run                                     | the earlier of `RUN_BUDGET_MS − SAVE_BUDGET_MS` (220 s) after it starts, and the absolute deadline − `SAVE_BUDGET_MS`. It's passed as `generateLlmsTxt`'s `budgetMs`. |
| After the run: text and record writes       | a fresh `SAVE_BUDGET_MS` signal, started when the run ends                                                                                                            |

The three phases add up to at most `RUN_BUDGET_MS + SAVE_BUDGET_MS` (260 s), the same total and headroom as a submit. The deadline counts from the start of the request, so a slow response delays `after()` without eating into the writes' time.

**Shorter than a submit.** A refresh gets 220 s, against a submit's 240 s. A site that needs 220–240 s finishes on submit, but each refresh comes back newly truncated and is rejected, until the 3-failure stop. Its link keeps its last good copy, with its true age.

### Load on other sites

IDs can be computed from a known docs URL, so anyone can trigger a check. It's bounded: at most one refresh per link per 24 h, none after 3 failures, and only for links still being read after their limit.
