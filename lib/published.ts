// How a site's own llms.txt becomes the result, before any crawl. docs/internals/crawler.md
// describes these rules in prose; keep the two in sync. Fetching lives in lib/generate.ts.

import { inScope, scopePath, widenScope } from "@/lib/scope";

/** A rebuilt file is used only when at least this many of its entries survive the scope. */
export const MIN_REBUILT_ENTRIES = 5;

/**
 * A list line `- [title](url)`, possibly indented, with anything after the link, usually
 * `: description`. The title may hold one level of brackets (`Joins [SQL]`), and the URL one
 * level of parentheses.
 */
const ENTRY = /^(\s*)- \[((?:\\.|\[[^\]]*\]|[^\]\\])*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)(.*)$/;

type Entry = { indent: string; title: string; href: string; rest: string };
type Section = { heading: string | null; entries: Entry[] };

/** An llms.txt split into the parts a rebuilt file keeps. Every other line is prose. */
export type ParsedLlmsTxt = {
  text: string;
  title: string;
  quote: string[];
  /** Entries before the first H2 sit in a section with no heading. */
  sections: Section[];
  entries: number;
};

/**
 * Splits a published file into its H1, its first blockquote, its H2 sections and their entries.
 * Returns null when the body is HTML, or doesn't start with `# ` after a BOM or whitespace.
 */
export function parseLlmsTxt(body: string): ParsedLlmsTxt | null {
  const text = body.replace(/^﻿/, "");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<") || !trimmed.startsWith("# ")) return null;
  const lines = trimmed.split(/\r?\n/);
  const title = lines[0].trimEnd();
  const quote: string[] = [];
  let index = 1;
  while (index < lines.length && !lines[index].trim()) index++;
  while (index < lines.length && lines[index].startsWith(">")) quote.push(lines[index++].trimEnd());
  const sections: Section[] = [{ heading: null, entries: [] }];
  let entries = 0;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("## ")) {
      sections.push({ heading: line.trimEnd(), entries: [] });
      continue;
    }
    const match = ENTRY.exec(line);
    if (!match) continue;
    const [, indent, entryTitle, href, rest] = match;
    sections.at(-1)!.entries.push({ indent, title: entryTitle, href, rest: rest.trimEnd() });
    entries++;
  }
  return { text, title, quote, sections, entries };
}

/** True when `url` is on `origin` inside `scope`, or is the scope root as Markdown (`/guide.md`). */
export function entryInScope(url: URL, origin: string, scope: string) {
  return (
    url.origin === origin && (inScope(url, scope) || url.pathname === `${scope.slice(0, -1)}.md`)
  );
}

/**
 * Keeps the entries that resolve, against `fileUrl`, to a URL inside `scope` on the file's origin,
 * each URL once. `verbatim` is true when the file needs no rewriting at all: every entry is kept,
 * and each is already absolute, fragment-free and unique.
 */
export function limitLlmsTxt(parsed: ParsedLlmsTxt, fileUrl: URL, scope: string) {
  const seen = new Set<string>();
  let verbatim = true;
  const lines = [parsed.title, ""];
  if (parsed.quote.length) lines.push(...parsed.quote, "");
  for (const section of parsed.sections) {
    const kept: string[] = [];
    for (const entry of section.entries) {
      let url: URL;
      try {
        url = new URL(entry.href, fileUrl);
      } catch {
        verbatim = false;
        continue;
      }
      if (!/^https?:\/\//i.test(entry.href) || entry.href.includes("#")) verbatim = false;
      url.hash = "";
      if (!entryInScope(url, fileUrl.origin, scope) || seen.has(url.href)) {
        verbatim = false;
        continue;
      }
      seen.add(url.href);
      kept.push(`${entry.indent}- [${entry.title}](${url.href})${entry.rest}`);
    }
    if (!kept.length) continue;
    if (section.heading) lines.push(section.heading, "");
    lines.push(...kept, "");
  }
  return { text: `${lines.join("\n").trim()}\n`, count: seen.size, verbatim };
}

/**
 * What a published file at `fileUrl` gives for a run anchored on `anchor`, or null when it isn't
 * used and the run crawls. A file used as-is has `filtered: false` and needs at least 1 entry; a
 * rebuilt one needs MIN_REBUILT_ENTRIES. Only the root file (`root`) may widen a sparse scope,
 * by the same rule as the crawl.
 */
export function publishedLlmsTxt(body: string, fileUrl: URL, anchor: URL, root: boolean) {
  const parsed = parseLlmsTxt(body);
  if (!parsed) return null;
  let scope = scopePath(anchor);
  let limited = limitLlmsTxt(parsed, fileUrl, scope);
  if (root && !limited.verbatim && limited.count < MIN_REBUILT_ENTRIES) {
    const wider = widenScope(anchor, limited.count);
    if (wider !== scope) {
      scope = wider;
      limited = limitLlmsTxt(parsed, fileUrl, scope);
    }
  }
  if (limited.verbatim && limited.count >= 1)
    return { text: parsed.text, count: limited.count, filtered: false, scope };
  if (!limited.verbatim && limited.count >= MIN_REBUILT_ENTRIES)
    return { text: limited.text, count: limited.count, filtered: true, scope };
  return null;
}
