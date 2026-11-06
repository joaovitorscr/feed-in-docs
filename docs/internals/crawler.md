# Crawler

How `generateLlmsTxt` in `lib/generate.ts` turns a start URL into an index. The scope rules live in `lib/scope.ts`. Update this file in the same PR that changes a rule.

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

## Discovery

1. The start page and `/sitemap.xml` on the typed origin are fetched at the same time. If the start page fails, the whole run fails. If it landed on another origin, that sitemap is discarded and `/sitemap.xml` is read again from the anchor's origin.
2. Sitemaps are read breadth-first. Each `<sitemap><loc>` on the same origin is queued as a nested sitemap, and each `<url><loc>` on the same origin is kept, with its hash and query removed. A sitemap that fails is skipped, so a site without one still works through links.
3. The scope is decided, including any widening. The crawl queue is then the in-scope sitemap URLs in sitemap order, followed by the start page's in-scope links.
4. Pages are fetched by a pool of 8 slots. Each slot takes the next queued URL as soon as its fetch finishes, so no slot waits on the slowest page of a batch. Each fetched page's in-scope links are appended to the queue in document order, and recorded under the URL the page was queued as.
5. Each page is parsed once. The same parse gives its title, description, project name, markdown link and links.

**Links** come from every `a[href]`. The hash and query are removed, and only same-origin links are kept. A path ending in `.png`, `.jpg`, `.jpeg`, `.svg`, `.pdf`, `.zip`, `.webp`, `.gif`, `.json` or `.xml` is dropped.

**Fetches** accept `text/html` and `text/markdown`, and sitemaps also accept XML and `text/plain`. A page served as `text/markdown` is fetched but not listed. Redirects are followed by hand, up to 3. The start page may redirect to another origin; every later fetch, sitemaps included, must stay on the anchor's origin.

## Dedupe

A URL is queued once, keyed by its exact `href` after the hash and query are removed. There's no other normalization. The start page is never queued again, under either the typed URL or the anchor. A page reachable under two URLs, such as with and without a trailing slash, or through a redirect, is listed once per URL.

## Entries

Each page with a title becomes one line, and the start page comes first. The order doesn't depend on which fetch finished first. After the crawl, the entries follow a breadth-first walk of the recorded links:

1. the start page;
2. the in-scope sitemap URLs in sitemap order, then the start page's in-scope links;
3. each placed page's in-scope links in document order, skipping URLs already placed.

So the same responses always give the same text.

- **Title:** the first `main h1`, then the first `h1`, then `<title>`, then the last path segment. Colons are removed and the title is cut to 100 characters.
- **Description:** the meta description, then the first `main p`, then the first `article p`, cut to 180 characters.
- **Link:** a same-origin `<link rel="alternate" type="text/markdown">` if the page declares one, otherwise the page URL.
- **Project name and summary:** taken from the start page. The project is the last `|`-separated part of `<head> <title>`, falling back to the hostname.

## Limits

- 8 requests at a time and 8 seconds per request.
- Pages up to 1 MB and sitemaps up to 10 MB.
- No page cap and no overall deadline.
- `assertPublicUrl` runs on every hop, including a start-page redirect to another origin. It rejects anything but HTTP and HTTPS, credentials, explicit ports, `localhost`, `.local`, and hosts that resolve to private or reserved addresses.
- A page that fails after the start page is counted in `failed` and skipped.
