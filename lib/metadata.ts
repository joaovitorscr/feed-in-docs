/** Permalink anchors docs generators put inside headings: Sphinx, VitePress, Docusaurus, GitHub-style. */
export const HEADING_ANCHORS = ".headerlink, .header-anchor, .hash-link, .anchor";

// A `#` counts only after whitespace, so "Learn C#" keeps its name.
const TRAILING_MARKS = /(?:[\s¶\u200B-\u200D\u2060\uFEFF]|\s#+)+$/u;
const SEPARATORS = / (?:\||-|–|—|·) /;
const GENERIC = new Set(["docs", "documentation", "home", "guide"]);
const NOT_SITE = new Set(["www", "docs", "developer", "developers"]);

/**
 * Collapses whitespace, then strips the trailing `¶`, `#` (after whitespace) and zero-width
 * characters that heading anchors leave behind.
 */
export function cleanTitle(text: string) {
  return text.replace(/\s+/g, " ").replace(TRAILING_MARKS, "").trim();
}

/** A `<title>` split on ` | `, ` - `, ` – `, ` — ` and ` · `, empty segments dropped. */
export function titleSegments(title: string) {
  return title
    .replace(/\s+/g, " ")
    .split(SEPARATORS)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** "{Site} Docs", where {Site} is the first hostname label that isn't `www`, `docs` or `developer(s)`. */
export function siteDocsName(hostname: string) {
  const labels = hostname.toLowerCase().split(".");
  const site = labels.find((label) => !NOT_SITE.has(label)) ?? labels[0];
  return `${site.charAt(0).toUpperCase()}${site.slice(1)} Docs`;
}

/**
 * The crawled index's project name, from the start page's metadata and the `<title>` of the next
 * page in output order: `application-name`, then a segment both titles share (the first or last
 * of each; the last match in the start title wins), then the start title when it has no
 * separator, then `og:site_name`, then the hostname. A generic result ("Docs", "Home") becomes
 * "{Site} Docs".
 */
export function projectName(start: {
  applicationName: string;
  headTitle: string;
  siteName: string;
  hostname: string;
  nextHeadTitle?: string;
}) {
  const name =
    start.applicationName ||
    sharedSegment(start.headTitle, start.nextHeadTitle ?? "") ||
    wholeTitle(start.headTitle) ||
    start.siteName ||
    start.hostname;
  return GENERIC.has(name.toLowerCase()) ? siteDocsName(start.hostname) : name;
}

function sharedSegment(startTitle: string, nextTitle: string) {
  const start = titleSegments(startTitle);
  const next = titleSegments(nextTitle);
  if (!start.length || !next.length) return "";
  const candidates = new Set([next[0], next.at(-1)]);
  for (const segment of [start.at(-1), start[0]])
    if (segment && candidates.has(segment)) return segment;
  return "";
}

/** A title with a single segment ("Next.js Docs") names the site, not a page within it. */
function wholeTitle(title: string) {
  const segments = titleSegments(title);
  return segments.length === 1 ? segments[0] : "";
}
