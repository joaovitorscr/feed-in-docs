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
