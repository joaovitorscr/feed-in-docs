/** Permalink anchors docs generators put inside headings: Sphinx, VitePress, Docusaurus, GitHub-style. */
export const HEADING_ANCHORS = ".headerlink, .header-anchor, .hash-link, .anchor";

/** Page chrome a fallback paragraph is never read from. */
export const PAGE_CHROME = "nav, header, footer, aside, [role=navigation]";

/** The shortest paragraph, in characters, that can stand in for a meta description. */
export const MIN_PARAGRAPH_LENGTH = 20;

/**
 * A meta description is the site's, not the page's, when at least this many entries share it
 * and they're at least SITE_WIDE_PERCENT of the listed entries.
 */
const SITE_WIDE_USES = 3;
const SITE_WIDE_PERCENT = 10;

/**
 * Each entry's description, in entry order. A site-wide meta description is replaced by the
 * page's paragraph, or none; every other description is kept, including one a page without a
 * meta description took from its first paragraph. Only the listed entries count, so the result
 * doesn't depend on fetch order.
 */
export function entryDescriptions(
  pages: Array<{ description: string; fromMeta: boolean; paragraph: string }>,
) {
  const uses = new Map<string, number>();
  for (const { description, fromMeta } of pages)
    if (fromMeta && description) uses.set(description, (uses.get(description) ?? 0) + 1);
  const siteWide = (description: string) => {
    const count = uses.get(description) ?? 0;
    return count >= SITE_WIDE_USES && count * 100 >= pages.length * SITE_WIDE_PERCENT;
  };
  return pages.map(({ description, fromMeta, paragraph }) =>
    fromMeta && siteWide(description) ? paragraph : description,
  );
}

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
