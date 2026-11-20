// How the crawler decides which part of a site belongs to the docs the user asked for.
// docs/internals/crawler.md describes these rules in prose; keep the two in sync.

/** Fewer distinct in-scope URLs than this lets a trailing-slash scope widen once. */
export const MIN_SCOPE_URLS = 5;

/** True for a path segment that names a numbered release: `3.8.1`, `2.x`, `v4`, `v1.2`. */
export function isNumericVersion(segment: string) {
  return (
    /^\d+(\.\d+)+$/.test(segment) || /^\d+\.x$/.test(segment) || /^v\d+(\.\d+)*$/.test(segment)
  );
}

/** True for a path segment that names a moving release channel such as `stable` or `next`. */
export function isReleaseChannel(segment: string) {
  return /^(latest|stable|next|canary|nightly|dev|unreleased)$/.test(segment);
}

function scopeRule(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const docsIndex = segments.findIndex((segment) =>
    ["docs", "documentation"].includes(segment.toLowerCase()),
  );
  if (docsIndex !== -1) {
    const end = isNumericVersion(segments[docsIndex + 1] ?? "") ? docsIndex + 2 : docsIndex + 1;
    return { path: `/${segments.slice(0, end).join("/")}/`, widenable: false };
  }
  if (url.pathname.endsWith("/")) return { path: url.pathname, widenable: true };
  return { path: url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1), widenable: false };
}

/**
 * The folder a crawl starting at `url` stays inside, always ending in `/`.
 * `/en/docs/guides/intro` → `/en/docs/`, `/docs/3.8.1/installation` → `/docs/3.8.1/`,
 * `/guide/intro` → `/guide/`, `/3/library/` → `/3/library/`.
 */
export function scopePath(url: URL) {
  return scopeRule(url).path;
}

/**
 * The scope after the start page and sitemap are read, given how many distinct
 * same-origin URLs fell inside `scopePath(url)`. Only a trailing-slash path with no
 * docs segment widens, once, to its parent folder, and never to `/` or across a
 * version or release-channel segment: `/en/getting-started/` with 1 URL → `/en/`.
 */
export function widenScope(url: URL, inScopeCount: number) {
  const { path, widenable } = scopeRule(url);
  if (!widenable || inScopeCount >= MIN_SCOPE_URLS) return path;
  const segments = path.split("/").filter(Boolean);
  const dropped = segments.at(-1);
  if (!dropped || segments.length < 2 || isNumericVersion(dropped) || isReleaseChannel(dropped))
    return path;
  return `/${segments.slice(0, -1).join("/")}/`;
}

/** True when `url`'s path is inside `scope`, counting the scope root without its slash. */
export function inScope(url: URL, scope: string) {
  return url.pathname.startsWith(scope) || url.pathname === scope.slice(0, -1);
}

/**
 * The key a crawl lists a page under once: the origin plus the path, without a trailing
 * `/index.html` or `/` (the root keeps its `/`), and without the hash and query.
 * `/docs/x`, `/docs/x/` and `/docs/x/index.html` share `https://site/docs/x`.
 */
export function pageKey(url: URL) {
  let path = url.pathname;
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${url.origin}${path}`;
}

/** Distinct numeric-version first segments a crawl must see before older versions are skipped. */
export const MIN_VERSIONS = 2;
/** In-scope URLs without a version first segment, besides the start page, needed for the same. */
export const MIN_UNVERSIONED_URLS = 5;

/**
 * The first path segment of `url` after `scope` when it's a numeric version or a release channel:
 * `/docs/3.8.1/installation` in `/docs/` → `3.8.1`. Null otherwise, so `/docs/api/v1/` → null.
 */
export function versionSegment(url: URL, scope: string) {
  if (!url.pathname.startsWith(scope)) return null;
  const segment = url.pathname.slice(scope.length).split("/")[0];
  return isNumericVersion(segment) || isReleaseChannel(segment) ? segment : null;
}

/**
 * Picks out older version copies of the docs inside `scope`. Pass every in-scope URL the crawl
 * finds to `see`, the start page's too; `skips(href)` is true for a URL whose first segment after
 * the scope is a numeric version or a release channel, once all of these hold:
 *
 * 1. at least MIN_VERSIONS distinct numeric-version first segments were seen;
 * 2. at least MIN_UNVERSIONED_URLS URLs, not counting `startHrefs`, have no version first segment;
 * 3. the anchor isn't inside a numeric version, either pinned by the scope (`/docs/3.8.1/`) or as
 *    its own first segment.
 *
 * The anchor's own first segment is never skipped, so a start at `/docs/next/x` keeps `next`.
 * The counts only grow, so once `skips` is true for a URL it stays true.
 */
export function versionFilter(anchor: URL, scope: string, startHrefs: Set<string>) {
  const startSegment = versionSegment(anchor, scope);
  const pinned =
    scope.split("/").some(isNumericVersion) || (!!startSegment && isNumericVersion(startSegment));
  const versions = new Set<string>();
  const unversioned = new Set<string>();
  const active = () =>
    !pinned && versions.size >= MIN_VERSIONS && unversioned.size >= MIN_UNVERSIONED_URLS;
  return {
    see(href: string) {
      const segment = versionSegment(new URL(href), scope);
      if (segment === null) {
        if (!startHrefs.has(href)) unversioned.add(href);
      } else if (isNumericVersion(segment)) versions.add(segment);
    },
    skips(href: string) {
      if (!active()) return false;
      const segment = versionSegment(new URL(href), scope);
      return segment !== null && segment !== startSegment;
    },
  };
}
