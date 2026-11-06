import { escapeMarkdown } from "@/lib/text";

/** A group needs this many pages for a section of its own; smaller ones go under Documentation. */
const MIN_SECTION_PAGES = 2;
/** With fewer groups of MIN_SECTION_PAGES or more, the index stays one flat list. */
const MIN_SECTIONS = 2;

/**
 * The path of `url` after `scope`, without a trailing `/` or `/index.html`, or "" for the
 * scope's root page (`/docs`, `/docs/`, `/docs/index.html` for `/docs/`).
 */
function scopedPath(url: URL, scope: string) {
  if (!url.pathname.startsWith(scope)) return "";
  return url.pathname.slice(scope.length).replace(/(?:^|\/)index\.html$|\/$/, "");
}

/** `getting-started` → "Getting started". Hyphens and underscores become spaces. */
export function sentenceCase(segment: string) {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    /* Keep a malformed escape as it is. */
  }
  text = text.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The index body after the summary: the entries' `lines`, grouped into `## ` sections by the
 * first path segment of each page's landed `url` after `scope`. Root pages and groups of one
 * page come first, under "## Documentation". Each other group is a section, ordered by its first
 * page, and headed by the `title` of the group's own page (`/docs/api` for `/docs/api/…`) when
 * it's listed, or else the segment in sentence case. Pages keep their order inside a section.
 * With fewer than MIN_SECTIONS such groups, it's one flat list under "## Documentation".
 * `title` is already escaped. Each line carries its own description, so none can misalign.
 */
export function sectionLines(
  entries: Array<{ url: URL; title: string; line: string }>,
  scope: string,
) {
  const segments = entries.map(({ url }) => scopedPath(url, scope).split("/")[0]);
  const groups = new Map<string, { heading: string; lines: string[] }>();
  for (const [index, { url, title, line }] of entries.entries()) {
    const segment = segments[index];
    if (!segment) continue;
    const group = groups.get(segment) ?? { heading: "", lines: [] };
    if (!group.heading && scopedPath(url, scope) === segment) group.heading = title;
    group.lines.push(line);
    groups.set(segment, group);
  }
  const sectioned = (segment: string) =>
    (groups.get(segment)?.lines.length ?? 0) >= MIN_SECTION_PAGES;
  const sections = [...groups].filter(([segment]) => sectioned(segment));
  if (sections.length < MIN_SECTIONS)
    return ["## Documentation", "", ...entries.map(({ line }) => line)];
  const documentation = entries.filter((_, index) => !sectioned(segments[index]));
  const lines = documentation.length
    ? ["## Documentation", "", ...documentation.map(({ line }) => line), ""]
    : [];
  for (const [segment, { heading, lines: pages }] of sections)
    lines.push(`## ${heading || escapeMarkdown(sentenceCase(segment))}`, "", ...pages, "");
  return lines;
}
