# Crawler

How `generateLlmsTxt` in `lib/generate.ts` turns a start URL into an index. The scope rules live in `lib/scope.ts`, and the rules for a site's own llms.txt in `lib/published.ts`. Update this file in the same PR that changes a rule.

A run has two modes. If the site publishes a usable llms.txt, the result is that file, limited to the scope (`mode: "published"`, see Published files). Otherwise the site is crawled (`mode: "crawled"`). `generateLlmsTxt(input, { crawl: true })`, and a POST with `"crawl": true`, skips the published check and always crawls.

## Scope

The crawl stays on one origin and inside one folder, the scope. Both come from the anchor: the URL the start page landed on after its redirects, with its hash and query removed. Only the start page may redirect to another origin, so `docs.readthedocs.io/en/stable/` anchors on `docs.readthedocs.com/platform/stable/`. `source`, and so the saved link's ID, stays the typed URL with its hash and query removed. `scopePath` picks the folder from the anchor's path with the first rule that matches:

1. **`docs` or `documentation` segment** (any case). The scope ends at that segment: `/en/docs/guides/intro` → `/en/docs/`. If the next segment is a numeric version, the scope extends through it: `/docs/3.8.1/installation` → `/docs/3.8.1/`.
2. **No trailing slash.** The parent folder: `/guide/intro` → `/guide/`.
3. **Trailing slash.** The path itself: `/3/library/` → `/3/library/`.

**Segment matchers.**

- `isNumericVersion`: `^\d+(\.\d+)+$`, `^\d+\.x$` or `^v\d+(\.\d+)*$`. So `3.8.1`, `2.x` and `v4` match, and `3` doesn't.
- `isReleaseChannel`: exactly `latest`, `stable`, `next`, `canary`, `nightly`, `dev` or `unreleased`.

**Widening (rule 3 only).** `widenScope` runs once, after the start page and the sitemaps are read. It counts the distinct same-origin URLs inside the scope: the start URL, the sitemap URLs and the start page's links. If there are fewer than 5 (`MIN_SCOPE_URLS`), the scope widens once to its parent folder. It doesn't widen when:

- the parent is `/`, or
- the segment being dropped is a numeric version or a release channel.

So `/en/getting-started/` with 1 URL becomes `/en/`, while `/en/stable/`, `/en/latest/` and `/en/next/` stay narrow even when sparse. Rules 1 and 2 never widen.

**In scope.** A URL is in scope when its path starts with the scope, or equals the scope without its trailing slash: `/en` is inside `/en/`.

## Older versions

Docs sites often keep a full copy of the docs per release beside the current ones: Docusaurus has `/docs/x` plus `/docs/3.8.1/x`, `/docs/2.x/x`, `/docs/next/x` and 9 more. A crawl lists the current docs once and skips those copies. `versionFilter` in `lib/scope.ts` holds the rule.

- **Which segment.** Only the first path segment after the crawl's scope is checked, with `isNumericVersion` and `isReleaseChannel`. With the scope `/docs/`, `/docs/3.8.1/x` and `/docs/next/x` are version copies, and nested sections like `/docs/api/v1/` are never touched.
- **When it turns on.** All three must hold:
  1. at least 2 distinct numeric-version first segments have been seen (`MIN_VERSIONS`); release channels don't count;
  2. at least 5 in-scope URLs, not counting the start page, have no version first segment (`MIN_UNVERSIONED_URLS`), so a site whose docs all live under `/docs/v2/` and `/docs/v3/` keeps every page;
  3. the start URL isn't inside a numeric version, either pinned by the scope (`/docs/3.8.1/installation` crawls `/docs/3.8.1/`) or as its own first segment after the scope.

  "Seen" means every in-scope URL the crawl has found: the start page, the sitemaps and every fetched page's links. The counts only grow, so once the filter is on it stays on.

- **What it skips.** In-scope URLs whose first segment is a numeric version or a release channel, except the segment the start URL itself sits in. A start at `/docs/next/x` keeps `next` beside the unversioned pages and skips the numbered copies.
- **When it's applied.** When the pool would start a URL, so a skipped URL is never fetched. With a sitemap, the filter is usually on before the first page starts. It's applied again when the entries are placed: a version copy fetched before the filter turned on (possible without a sitemap) has no entry, and its links aren't followed. So the result doesn't depend on the order pages answer in.
- **Counting.** A skipped URL isn't `failed` and isn't `unread`.

A versioned start URL indexes that version: `/docs/3.8.1/installation` gives `/docs/3.8.1/` and nothing else.

## Published files

The check runs after the start fetch and re-anchoring, before sitemap discovery, and only when `crawl` isn't set.

**Candidates.** `{scope}llms.txt`, when the scope isn't `/`, and `/llms.txt`. Both are fetched at once, through `fetchText` with `Accept: text/markdown, text/plain`, so they share the run deadline, the 8-second timeout, the DNS check, the 1 MB limit and the same-origin redirect rule. A scope file that redirects to `/llms.txt` (Supabase) is treated as the root file. The scope's own file wins if it's used; the root file is used otherwise.

**Validation**, in order. Status and headers are checked before any of the body is read:

1. The response is OK. A 404 with an HTML body, like Tailwind's 130 KB page or Hono's `text/plain` 404, is rejected before its body downloads.
2. The content type isn't HTML (`text/html` or `application/xhtml`).
3. The first non-whitespace character isn't `<`, which catches a soft 404 that returns 200.
4. After a BOM or whitespace, the body starts with `# `.
5. It fits `MAX_BYTES` (1 MB), counted while streaming.

A candidate that fails any step, or any network error, is skipped. If neither is used, the run crawls.

**Entries.** `parseLlmsTxt` reads a list line `- [title](url)`, possibly indented, with anything after the link (usually `: description`). The title may hold one level of brackets (`Joins [SQL]`), and the URL one level of parentheses. `*` bullets and lines like `Title: URL` aren't entries, so ReadTheDocs' root file parses to 0 entries.

- Each URL is resolved against the file's own URL, after redirects.
- An entry is valid when it's on the file's origin and its path is in scope, or equals the scope root as Markdown, `{scope root}.md` (Vite lists `/guide.md`). This applies to the scope's own file too.
- Duplicates, compared without the fragment, keep the first entry.

**Verbatim or rebuilt.** `limitLlmsTxt` decides.

- **Verbatim** (`filtered: false`): every entry is valid, absolute, fragment-free and unique, so nothing needs rewriting. The text is the file as served, minus a leading BOM. The served copy lives on our origin, where relative links would break, so a file with any relative link is rebuilt.
- **Rebuilt** (`filtered: true`): everything else. The text keeps the H1, the first blockquote, each H2 that still has valid entries, and those entries in their original order and indentation, with absolute URLs and no fragments. Entries before the first H2 come first, with no heading. Other prose, H3s and later blockquotes are dropped.

**Widening.** A rebuilt root file with fewer than 5 valid entries is re-filtered against `widenScope(anchor, entries)`, the crawl's own rule. The scope's own file never widens.

**Accepted** when the file is verbatim with at least 1 entry, or rebuilt with at least 5 (`MIN_REBUILT_ENTRIES`). Otherwise the run crawls.

**Result.** `count` is the number of entries, `failed` is 0, `truncated` is `false` and `unread` is 0, because the file is read whole. `publishedUrl` is the file's URL after redirects, and `scope` is the scope it was limited to.

**A start page too large to read.** Re-anchoring only needs the URL the start page landed on, not its body. When the body is over `MAX_BYTES` (Stripe's 1.84 MB home page), the landed URL still anchors the published check. If a file is used, it's returned; if not, the run fails with "A documentation page is too large.", as before. A crawl (`crawl: true`) still fails on it straight away.

## Discovery

1. With `crawl: true`, the start page and `/sitemap.xml` on the typed origin are fetched at the same time. Otherwise the start page is fetched, then the published check runs, and the sitemap is read from the anchor's origin only if no published file is used. If the start page fails, the whole run fails. If it landed on another origin, the typed origin's sitemap is discarded and `/sitemap.xml` is read again from the anchor's origin.
2. Sitemaps are read breadth-first. Each `<sitemap><loc>` on the same origin is queued as a nested sitemap, and each `<url><loc>` on the same origin is kept, with its hash and query removed. A sitemap that fails is skipped, so a site without one still works through links.
3. The scope is decided, including any widening. The crawl queue is then the in-scope sitemap URLs in sitemap order, followed by the start page's in-scope links.
4. Pages are fetched by a pool of 8 slots. Each slot takes the next queued URL as soon as its fetch finishes, so no slot waits on the slowest page of a batch. It passes over older version copies without fetching them (see Older versions). Each fetched page's in-scope links are appended to the queue in document order, and recorded under the URL the page was queued as.
5. Each page is parsed once. The same parse gives its title, description, project name, markdown link and links.

**Links** come from every `a[href]`. The hash and query are removed, and only same-origin links are kept. A path ending in `.png`, `.jpg`, `.jpeg`, `.svg`, `.pdf`, `.zip`, `.webp`, `.gif`, `.json` or `.xml` is dropped.

**Fetches** accept `text/html` and `text/markdown`, and sitemaps also accept XML and `text/plain`. A published llms.txt candidate accepts any type but HTML (see Published files). A page served as `text/markdown` is fetched but not listed. Redirects are followed by hand, up to 3. The start page may redirect to another origin; every later fetch, sitemaps included, must stay on the anchor's origin.

## Dedupe

A URL is queued once, keyed by its exact `href` after the hash and query are removed. There's no other normalization. The start page is never queued again, under either the typed URL or the anchor. A page reachable under two URLs, such as with and without a trailing slash, or through a redirect, is listed once per URL.

## Entries

Each page with a title becomes one line, and the start page comes first. The order doesn't depend on which fetch finished first. After the crawl, the entries follow a breadth-first walk of the recorded links:

1. the start page;
2. the in-scope sitemap URLs in sitemap order, then the start page's in-scope links;
3. each placed page's in-scope links in document order, skipping URLs already placed.

Older version copies are left out at every step, and their links aren't followed. So the same responses always give the same text.

- **Title:** the first `main h1`, then the first `h1`, then `<title>`, then the last path segment. Colons are removed and the title is cut to 100 characters.
- **Description:** the meta description, then the first `main p`, then the first `article p`, cut to 180 characters.
- **Link:** a same-origin `<link rel="alternate" type="text/markdown">` if the page declares one, otherwise the page URL.
- **Project name and summary:** taken from the start page. The project is the last `|`-separated part of `<head> <title>`, falling back to the hostname.

## Limits

- 8 requests at a time and 8 seconds per request.
- Pages up to 1 MB (`MAX_BYTES`) and sitemaps up to 10 MB (`MAX_SITEMAP_BYTES`), counted in bytes. A `content-length` over the limit is rejected before reading. Otherwise `readText` counts bytes as the body streams in and cancels the download once it passes the limit, so a missing or wrong `content-length` can't make the crawler hold an oversized body. Either way the error is "A documentation page is too large."
- No page cap. The run deadline and the size limits bound the work (see Deadlines).
- `assertPublicUrl` runs on every hop, including a start-page redirect to another origin. It rejects anything but HTTP and HTTPS, credentials, explicit ports, `localhost`, `.local`, and hosts that resolve to private or reserved addresses.
- A page that fails after the start page is counted in `failed` and skipped. A page the run deadline stopped is counted in `unread` instead.

## Deadlines

The budgets live in `lib/limits.ts`. `app/api/generate/route.ts` exports `maxDuration = 300` as a literal, because Next reads it statically. `RUN_BUDGET_MS + SAVE_BUDGET_MS` (240 s + 20 s) must stay at least 5 s under it, so the route answers before the platform's own timeout returns a 504.

- **Run deadline.** `generateLlmsTxt(input, { budgetMs })` starts a timer when it's called. `budgetMs` defaults to `RUN_BUDGET_MS`, and the route always uses the default. When the timer fires, it aborts one signal with a `DeadlineError`.
  - Every hop of every fetch, start page and sitemaps included, uses `AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)])`. So its timeout is 8 seconds or the time left, whichever is shorter. The signal covers the DNS lookup (raced against it, since `lookup` takes no signal), the request and the body read.
  - No hop starts after the deadline, and the pool starts no new page.
  - The two timeouts give different errors. A fetch stopped by its own 8 seconds throws a `TimeoutError` and counts in `failed`. A fetch stopped by the deadline throws the deadline's `DeadlineError`, and `crawl` counts it in `unread`.
  - If the deadline stops the start page itself, the run fails with "This website took too long to respond."
- **Storage deadline.** `AbortSignal.timeout(SAVE_BUDGET_MS)`, made once when the crawl returns. Every Blob call in the request takes it: the text `put`, then the record `put` (see `links.md`). If the text `put` times out, `saveLlmsTxt` returns `null`, and the response has `link: null`. If only the record `put` does, the response keeps its link.

## Response

`generateLlmsTxt` returns `text`, `count`, `failed`, `truncated`, `unread`, `unreadIsLowerBound`, `mode`, `publishedUrl`, `filtered`, `scope` and `source`. The route sends everything but `source`, and adds `link`.

- **`mode`** is `"published"` or `"crawled"`. A crawl has `publishedUrl: null` and `filtered: false`, and its `scope` is the folder it crawled, after any widening.

- **`unread`** counts in-scope URLs that were queued but never fetched, plus fetches the deadline cut short. The queue only holds in-scope URLs, each once, so `unread` never counts a duplicate, an out-of-scope URL, or a page in `failed`. A skipped older version copy isn't counted either.
- **`unreadIsLowerBound`** is true when the deadline stopped the sitemap walk with sitemaps still unread. Their pages were never found, so more pages may exist than `unread` counts.
- **`truncated`** is `unread > 0 || unreadIsLowerBound`. A deadline that fires after the last page is read doesn't truncate anything.
- **Order.** A truncated index uses the same breadth-first order over the pages that were read. A page that wasn't read has no entry, and its links aren't followed.
- **Size.** The route measures the JSON response, not the text, against `MAX_RESPONSE_BYTES` (4.4 MB, under Vercel's 4.5 MB limit), and returns a 413 when it's over.
