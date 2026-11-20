# Crawler

How `generateLlmsTxt` in `lib/generate.ts` turns a start URL into an index. The scope rules live in `lib/scope.ts`, the rules for a site's own llms.txt in `lib/published.ts`, and the grouping into sections in `lib/sections.ts`. Update this file in the same PR that changes a rule.

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

  "Seen" means every in-scope page the crawl has found: the start page, the sitemaps and every fetched page's links, each under the first URL found for its key (see Dedupe). So `/docs/x` and `/docs/x/` count once. The counts only grow, so once the filter is on it stays on.

- **What it skips.** In-scope URLs whose first segment is a numeric version or a release channel, except the segment the start URL itself sits in. A start at `/docs/next/x` keeps `next` beside the unversioned pages and skips the numbered copies.
- **When it's applied.** When the pool would start a URL, so a skipped URL is never fetched. With a sitemap, the filter is usually on before the first page starts. It's applied again when the entries are placed: a version copy fetched before the filter turned on (possible without a sitemap) has no entry, and its links aren't followed. So the result doesn't depend on the order pages answer in.
- **Redirects into a copy.** Both places also check where a page landed. A page that redirects into a skipped copy (`/docs/x` → `/docs/3.9.2/x`) is dropped like a page that lands outside the scope: no entry, and its links aren't followed.
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

1. With `crawl: true`, the start page and the typed origin's sitemaps are fetched at the same time. Otherwise the start page is fetched, then the published check runs, and the sitemaps are read from the anchor's origin only if no published file is used. If the start page fails, the whole run fails. If it landed on another origin, the typed origin's sitemaps are discarded and read again from the anchor's origin.
2. **Sources.** `/robots.txt` is fetched first and alone (`Accept: text/plain`, any type but HTML, up to 1 MB). Only its `Sitemap:` lines are read: the key is matched without case, `#` starts a comment, a relative value resolves against robots.txt, and a sitemap on another origin is ignored. `Disallow` and every other line are ignored. The walk then starts from those sitemaps in file order, then `/sitemap.xml`, with duplicates removed, so `/sitemap.xml` listed in robots.txt keeps robots.txt's position. A missing robots.txt, an error status, or one served as HTML gives no sources, and `/sitemap.xml` is still tried. Drizzle lists its sitemap only in robots.txt.
3. **The walk.** Sitemaps are read breadth-first, one level at a time. Level 0 is the sources in that order. Each `<sitemap><loc>` on the same origin is a nested sitemap for the next level, and each `<url><loc>` on the same origin is kept, with its hash and query removed. A sitemap that fails is skipped, so a site without one still works through links.
   - **Position.** Each file's position is a path: a source's is its index (`[0]`, `[1]`, …), and a nested sitemap's is its parent's path with its own index in the parent appended. Paths are compared one element at a time, so `[0, 1]` ranks before `[1, 0]`. A level is held as a list in path order: the next level is built from the current one's files in path order, each contributing its nested sitemaps in file order.
   - **Admission.** A level's files are admitted in path order, skipping any file already admitted, at that level or an earlier one (a self-reference, or `/sitemap.xml` listed again by an index). So each file is read once, at its first position.
   - **Loading.** The admitted files load 4 at a time (`SITEMAP_CONCURRENCY`), each starting as soon as a slot frees. The next level is admitted only once every file of this one has loaded.
   - **Merge.** Each file's pages and nested sitemaps are stored at its position, never in the order files answer. Pages are merged by level, then path, the same order as admission, so the result is what reading the files one at a time from a FIFO queue gives.
   - **Cap.** At most 50 files are read per run (`MAX_SITEMAP_FILES`; robots.txt doesn't count). Files are admitted in that order until the cap is reached, so which 50 are read doesn't depend on which answered first. A file left over at the cap sets `truncated` and `unreadIsLowerBound` (see Response); reaching exactly 50 with nothing left over doesn't.
   - **Deadline.** No sitemap starts after the run deadline. A file the deadline stopped, or never started, ends the walk after its level: the files of that level that loaded are still merged, and `unreadIsLowerBound` is set.
   - **Not read.** `.xml.gz` sitemaps aren't decompressed: none of the eval sites serves one.
4. The scope is decided, including any widening. The crawl queue is then the in-scope sitemap URLs in sitemap order, followed by the start page's in-scope links.
5. Pages are fetched by a pool of 8 slots. Each slot takes the next queued URL as soon as its fetch finishes, so no slot waits on the slowest page of a batch. It passes over older version copies without fetching them (see Older versions). Each fetched page's in-scope links are appended to the queue in document order, skipping keys already queued (see Dedupe). They're recorded under the URL the page was queued as, each rewritten to the URL its key is queued under.
6. Each page is parsed once. The same parse gives its title, description, the metadata the project name is read from, markdown link and links.

**Links** come from every `a[href]`. The hash and query are removed, and only same-origin links are kept. A path ending in `.png`, `.jpg`, `.jpeg`, `.svg`, `.pdf`, `.zip`, `.webp`, `.gif`, `.json` or `.xml` is dropped.

**Fetches** accept `text/html` and `text/markdown`, and sitemaps also accept XML and `text/plain`. A published llms.txt candidate accepts any type but HTML (see Published files). A page served as `text/markdown` is fetched but not listed. Redirects are followed by hand, up to 3. The start page may redirect to another origin; every later fetch, sitemaps included, must stay on the anchor's origin.

## Dedupe

Each page is listed once, under a URL inside the scope.

- **Key.** `pageKey` in `lib/scope.ts`: the origin plus the path, with a trailing `/index.html` or `/` removed, except for the root, which keeps its `/`. The hash and query are already gone. So `/docs/x`, `/docs/x/` and `/docs/x/index.html` share `https://site/docs/x`, while `/docs/x.html` and `/docs/x.md` are keys of their own. Path case is kept.
- **Before fetching.** A URL whose key is already scheduled is skipped, so each key is fetched once, under the first URL found for it: sitemap order, then the start page's links, then each page's links. The start page's key is scheduled from the start, under both the typed URL and the anchor. A key found only through links, under two forms on two pages, is fetched under whichever form was found first. If a site serves both forms without redirecting, which form is listed, and the links read from it, can then depend on which page answered first. With a sitemap, most keys are seeded in sitemap order before any page answers.
- **After fetching**, by where the page landed after its redirects:
  - A page that landed outside the scope (a same-origin redirect from `/docs/moved` to `/blog/moved`) is dropped, and its links aren't followed. It isn't counted as `failed`.
  - A page that landed in an older version copy the filter skips is dropped the same way (see Older versions).
  - Pages whose landing URLs share a key, such as a URL and the page it redirects to, keep the one the breadth-first walk (see Entries) places first. The walk leaves out older version copies before this runs. A page that redirects onto the start page's key is dropped, because the start page is placed first.
  - An entry whose link repeats an earlier entry's link is dropped.
- **No canonical tags.** `<link rel="canonical">` is ignored, because it's often wrong.

## Entries

Each page with a title becomes one line, and the start page is the first entry. The order doesn't depend on which fetch finished first. After the crawl, the entries follow a breadth-first walk of the recorded links:

1. the start page;
2. the in-scope sitemap URLs in sitemap order, then the start page's in-scope links;
3. each placed page's in-scope links in document order, skipping URLs already placed.

Older version copies are left out at every step, and their links aren't followed, judged both by the URL a page was queued as and by where it landed. A page that landed outside the scope is left out the same way. Then a page that landed on a key already placed is dropped, and so is an entry whose link repeats (see Dedupe). So the same responses give the same text, apart from the two-form case in Dedupe.

- **Title:** the first `main h1`, then the first `h1`, then `<title>`, then the last path segment. A heading is read without its permalink anchors (`.headerlink`, `.header-anchor`, `.hash-link`, `.anchor`), whose links are still collected. Then trailing `¶`, zero-width characters and a `#` after whitespace are stripped (so "Learn C#" keeps its `#`). Colons are removed and the title is cut to 100 characters.
- **Description:** the meta description; a page without one takes the first `main p`, then the first `article p`, as it is. Cut to 180 characters.
  - **Site-wide.** After the crawl, a meta description is the site's, not the page's, when 3 or more entries share it and they're at least 10% of the listed entries (Drizzle's sits on 761 of 812, Hono's on all 88). Supabase's per-method descriptions, each repeated on 6 version copies of its reference, stay: no Supabase description is on more than 70 of its 2,363 entries. Only the listed entries are counted, so the count doesn't depend on fetch order, and a page dropped as a duplicate doesn't count. Descriptions a page took from a paragraph are never site-wide (`entryDescriptions` in `lib/metadata.ts`).
  - **Fallback.** A site-wide meta description is replaced by the page's first paragraph, or by none. That's the first `main p`, then the first `article p`, that isn't inside `nav`, `header`, `footer`, `aside` or `[role=navigation]` and is at least 20 characters once whitespace collapses, cut to 180 characters. Paragraphs are skipped by their ancestors, so nothing is removed from the page and links inside the chrome are still collected.
- **Link:** a `<link rel="alternate" type="text/markdown">` if the page declares one on the anchor's origin inside the scope, or the scope root as Markdown (`/docs.md`), the same rule as published files. Otherwise the URL the page landed on after its redirects. An alternate outside the scope is ignored.
- **Summary:** the start page's description, even when it's site-wide, or "Documentation for {project}."
- **Project name:** from the start page (the first entry, before grouping into Sections) and the `<head> <title>` of the next entry in output order. In order (`projectName` in `lib/metadata.ts`):
  1. `application-name`.
  2. A segment both titles share. Titles split on `|`, `-`, `–`, `—` and `·` with a space on each side, so `Server-side` stays whole. Only the first and last segment of each are compared, because Hono and Drizzle put the name first and most sites put it last. If both of the start title's match, the last one wins (`Docs | Acme` gives Acme).
  3. The start title itself, when it has no separator (Next.js's "Next.js Docs", whose next page is titled "devIndicators").
  4. `og:site_name`. It comes after the titles because Vite's is "vitejs".
  5. The hostname.

  A generic result (`docs`, `documentation`, `home` or `guide`, ignoring case) becomes "{Site} Docs", where {Site} is the first hostname label that isn't `www`, `docs`, `developer` or `developers`, capitalized: Astro's "Docs" on `docs.astro.build` is "Astro Docs". A published llms.txt keeps its own heading.

## Sections

A crawled index is grouped into `## ` sections by the site's folders, after the entries, their order and their descriptions are decided (`sectionLines` in `lib/sections.ts`). Each line is written with its own description first, so grouping moves whole lines and a description can't land on another URL.

- **Groups.** Each entry is grouped by the first path segment, after the crawl's scope, of the URL its page landed on, not its Markdown alternate. With the scope `/docs/`, `/docs/api/routing` and `/docs/api` are in `api`. The scope's root page (`/docs`, `/docs/`, `/docs/index.html`) has no group. `/docs/text.html` and `/docs/text/x` are different segments.
- **Documentation first.** Root pages and groups of one page go under "## Documentation", in entry order. It's left out when it would be empty.
- **Sections.** Each group of 2 or more pages (`MIN_SECTION_PAGES`) is a section after Documentation. Sections are ordered by their first entry, and entries keep their order inside each section. So moving single-page groups up changes the order across the whole index, never the order inside a section. The start page comes first unless it's in a section (it then leads its section).
- **Headings.** A section's heading is its own page's entry title, the page whose path after the scope is just the segment (`/docs/api`, `/docs/api/` or `/docs/api/index.html`), when that page is listed. Otherwise it's the segment in sentence case: hyphens and underscores become spaces, and the first letter is capitalized, so `getting-started` is "Getting started" and `api` is "Api". Titles are used as they are, so Drizzle's own pages give "Drizzle ORM - Guides", and a heading can repeat "Documentation" (Mintlify's `fr` copy).
- **Fallback.** With fewer than 2 sections (`MIN_SECTIONS`), the index is one flat list under "## Documentation", the layout from before sections. Tailwind (193 of its 219 pages sit at `/docs/<page>`, 26 under `/docs/installation/`), Python and Vite fall back.
- **No `## Optional`.** Nothing is marked as skippable. That's the site author's call, in a published file.
- **Published files** keep their own sections: verbatim, or rebuilt with their own H2s (see Published files). They're never regrouped.

## Limits

- 8 requests at a time and 8 seconds per request.
- Pages up to 1 MB (`MAX_BYTES`) and sitemaps up to 10 MB (`MAX_SITEMAP_BYTES`), counted in bytes. A `content-length` over the limit is rejected before reading. Otherwise `readText` counts bytes as the body streams in and cancels the download once it passes the limit, so a missing or wrong `content-length` can't make the crawler hold an oversized body. Either way the error is "A documentation page is too large."
- At most 50 sitemap files per run, read 4 at a time (see Discovery).
- No page cap. The run deadline and the size limits bound the work (see Deadlines).
- `assertPublicUrl` runs on every hop, including a start-page redirect to another origin. It rejects anything but HTTP and HTTPS, credentials, explicit ports, `localhost`, `.local`, and hosts that resolve to private or reserved addresses.
- A page that fails after the start page is counted in `failed` and skipped. A page the run deadline stopped is counted in `unread` instead.

## Deadlines

The budgets live in `lib/limits.ts`. `app/api/generate/route.ts` exports `maxDuration = 300` as a literal, because Next reads it statically. `RUN_BUDGET_MS + SAVE_BUDGET_MS` (240 s + 20 s) must stay at least 5 s under it, so the route answers before the platform's own timeout returns a 504.

- **Run deadline.** `generateLlmsTxt(input, { budgetMs })` starts a timer when it's called. `budgetMs` defaults to `RUN_BUDGET_MS`, and the route always uses the default. When the timer fires, it aborts one signal with a `DeadlineError`.
  - Every hop of every fetch, start page, robots.txt and sitemaps included, uses `AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)])`. So its timeout is 8 seconds or the time left, whichever is shorter. The signal covers the DNS lookup (raced against it, since `lookup` takes no signal), the request and the body read.
  - No hop starts after the deadline, and the pool starts no new page.
  - The two timeouts give different errors. A fetch stopped by its own 8 seconds throws a `TimeoutError` and counts in `failed`. A fetch stopped by the deadline throws the deadline's `DeadlineError`, and `crawl` counts it in `unread`.
  - If the deadline stops the start page itself, the run fails with "This website took too long to respond."
- **Storage deadline.** `AbortSignal.timeout(SAVE_BUDGET_MS)`, made once when the crawl returns. Every Blob call in the request takes it: the text `put`, then the record `put` (see `links.md`). If the text `put` times out, `saveLlmsTxt` returns `null`, and the response has `link: null`. If only the record `put` does, the response keeps its link.

## Response

`generateLlmsTxt` returns `text`, `count`, `failed`, `truncated`, `unread`, `unreadIsLowerBound`, `mode`, `publishedUrl`, `filtered`, `scope` and `source`. The route sends everything but `source`, and adds `link`.

- **`mode`** is `"published"` or `"crawled"`. A crawl has `publishedUrl: null` and `filtered: false`, and its `scope` is the folder it crawled, after any widening.

- **`unread`** counts in-scope URLs that were queued but never fetched, plus fetches the deadline cut short. The queue only holds in-scope URLs, each key once, so `unread` never counts a duplicate (`/docs/x` beside `/docs/x/`), an out-of-scope URL, or a page in `failed`. A skipped older version copy isn't counted either.
- **`unreadIsLowerBound`** is true when the deadline stopped the sitemap walk, robots.txt included, or the 50-file cap left sitemaps unread. Their pages were never found, so more pages may exist than `unread` counts.
- **`truncated`** is `unread > 0 || unreadIsLowerBound`. A deadline that fires after the last page is read doesn't truncate anything.
- **Order.** A truncated index uses the same breadth-first order over the pages that were read. A page that wasn't read has no entry, and its links aren't followed.
- **Size.** The route measures the JSON response, not the text, against `MAX_RESPONSE_BYTES` (4.4 MB, under Vercel's 4.5 MB limit), and returns a 413 when it's over.
