# Saved links

`lib/links.ts` saves each result and reads it back. `app/api/generate/route.ts` saves, and `app/l/[id]/llms.txt/route.ts` serves.

## IDs

The ID is the first 16 hex characters of the SHA-256 of `source`, the URL as typed, before any redirect. Generating the same URL again overwrites the same link. The ID can't be reversed, so the record below is the only place the source is kept.

## Blobs

Each link is two private blobs, written in this order:

1. **`llms/{id}.txt`**, the text, with `cacheControlMaxAge: 60`.
2. **`llms/{id}.json`**, the record, written only after the text `put` succeeds.

Both are unconditional overwrites (`allowOverwrite: true`), so a manual submit always replaces the text and the record. Both take the request's one storage deadline (`SAVE_BUDGET_MS`, see `crawler.md`). A failed or timed-out text `put` gives `link: null`. A failed or timed-out record `put` is logged as "Could not save the llms.txt record", and the response keeps its link. The link then works with no record, like an older link.

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
  "textEtag": "\"…\""
}
```

- **`source`** is the URL as typed, the one the ID hashes.
- **`request`** is what was asked for: `"crawl"` when the POST sent `crawl: true`, `"auto"` otherwise. A rerun with the same `source` and `request` repeats the request, so a choice to crawl is never undone.
- **`mode`**, **`filtered`**, **`count`** and **`truncated`** are copied from the generate result.
- **`generatedAt`** is when the run finished, just before the text `put`.
- **`textEtag`** is the `etag` the text `put` returned. When it differs from the text blob's current ETag, the record no longer describes the text: either the record write failed after a text write, or a later write replaced the text.

**Comparing ETags.** `put()` and `head()` return a strong ETag (`"bd8b…"`), and `get()` returns the same value marked weak (`W/"bd8b…"`), with or without the CDN. So `textEtag` never equals a read's `blob.etag` with `===`. Compare them with `sameEtag(a, b)` from `lib/links.ts`, which strips a leading `W/` from both. The record keeps the strong ETag, because `ifMatch` needs it.

`scope` and `publishedUrl` are left out. A refresh reruns from `source` and `request` and gets them again.

## Serving

`readLlmsTxt` makes one `get` for the text, with `useCache: false`, and returns its stream, its `blob` (with `etag`) and `uploadedAt`. The route sends `Last-Modified` from `uploadedAt`, so a link shows its true age without a second Blob call. The read doesn't touch the record.

- **Why origin, not the Blob CDN.** The SDK fills `uploadedAt` from the response's `last-modified` header. Through the Blob CDN, that header is when the CDN cached the file, not when it was uploaded, so a cached read reports a link as minutes old however old it is. From origin it equals `head().uploadedAt`. An origin read took 156–186 ms against 22–84 ms through the CDN when measured (5 reads each).
- **No header.** When `last-modified` is missing, the SDK reports the time of the read, so `readLlmsTxt` returns `uploadedAt: null`, and the route sends no `Last-Modified`.

Responses carry `Cache-Control: public, max-age=60, s-maxage=60`, so the route only reads origin on a cache miss, and a CDN hit can be up to a minute old.

## Links without a record

Links saved before records existed have only the text. They serve exactly as before, with `Last-Modified` added, and refresh only when the same URL is submitted again.
