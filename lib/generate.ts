import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { RUN_BUDGET_MS } from "@/lib/limits";
import { entryInScope, publishedLlmsTxt } from "@/lib/published";
import { inScope, pageKey, scopePath, versionFilter, widenScope } from "@/lib/scope";
import {
  cleanTitle,
  entryDescriptions,
  HEADING_ANCHORS,
  MIN_PARAGRAPH_LENGTH,
  PAGE_CHROME,
  projectName,
} from "@/lib/metadata";
import { escapeMarkdown, truncate } from "@/lib/text";

const MAX_BYTES = 1_000_000;
const MAX_SITEMAP_BYTES = 10_000_000;
const TIMEOUT_MS = 8_000;
const CONCURRENCY = 8;
const SITEMAP_CONCURRENCY = 4;
const MAX_SITEMAP_FILES = 50;
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 180;

/** Why a fetch stopped when the run's time budget ran out. The crawl counts these as unread, not failed. */
export class DeadlineError extends Error {
  name = "DeadlineError";
  constructor() {
    super("The crawl ran out of time.");
  }
}

/**
 * A body over its byte limit. `url` is where the fetch landed after its redirects, so a start page
 * too large to read can still anchor the check for a published llms.txt.
 */
class PageTooLargeError extends Error {
  name = "PageTooLargeError";
  constructor(readonly url: URL) {
    super("A documentation page is too large.");
  }
}

/** Rejects with the signal's reason as soon as it aborts. For steps that take no signal, like DNS. */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

type Page = {
  title: string;
  /** `<head> <title>`, `application-name` and `og:site_name`, read for the project name. */
  headTitle: string;
  applicationName: string;
  siteName: string;
  /**
   * The meta description, or for a page without one, its first `main p`, then its first
   * `article p`; cut to MAX_DESCRIPTION_LENGTH.
   */
  description: string;
  /** True when `description` is the meta description, the only kind that can be site-wide. */
  fromMeta: boolean;
  /**
   * The first `main p`, then `article p`, outside the page chrome and at least
   * MIN_PARAGRAPH_LENGTH characters long, cut the same way. Stands in for a site-wide meta
   * description.
   */
  paragraph: string;
  /** Where the page landed after its redirects. */
  url: URL;
  /** A same-origin `<link rel="alternate" type="text/markdown">`, or null. */
  alternate: URL | null;
  links: string[];
};

function isPrivateIp(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:")
    );
  }
  const parts = address.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

// Pass `signal` to race the DNS lookup against it. An abort rejects with the signal's reason.
async function assertPublicUrl(url: URL, signal?: AbortSignal) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Enter a public HTTP or HTTPS documentation URL.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Enter a public documentation URL.");
  }
  let addresses: Array<{ address: string }>;
  try {
    if (isIP(host)) addresses = [{ address: host }];
    else {
      const pending = lookup(host, { all: true });
      addresses = await (signal ? raceSignal(pending, signal) : pending);
    }
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new Error("Could not find this website. Check the URL and try again.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Enter a public documentation URL.");
  }
}

// Decodes the body as UTF-8, like `response.text()`, but counts bytes as they arrive and
// cancels the download once it passes `maxBytes`, whatever `content-length` claimed.
async function readText(response: Response, maxBytes: number, url: URL) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new PageTooLargeError(url);
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** What a fetch asks for. Each kind sends its own `Accept` and accepts its own content types. */
type FetchKind = "page" | "sitemap" | "llms" | "robots";

const ACCEPT: Record<FetchKind, string> = {
  page: "text/html",
  sitemap: "application/xml, text/xml",
  llms: "text/markdown, text/plain",
  robots: "text/plain",
};

function acceptsType(kind: FetchKind, type: string) {
  // A published llms.txt or a robots.txt may come as any type but HTML, so a soft-404 page is
  // rejected. An llms.txt body is checked after reading.
  if (kind === "llms" || kind === "robots")
    return !type.includes("text/html") && !type.includes("application/xhtml");
  return (
    type.includes("text/html") ||
    type.includes("text/markdown") ||
    (kind === "sitemap" && (type.includes("xml") || type.includes("text/plain")))
  );
}

// Follows up to 3 redirects by hand, checking every hop. Pass `expectedOrigin: null` only
// for the start page, which may redirect to another website; every other fetch stays on it.
// Each hop's DNS lookup, request and body read share one signal: the run's `deadline`, or
// TIMEOUT_MS for that hop, whichever ends first. No hop starts once the deadline has passed.
// The status and content type are checked before any of the body is read.
async function fetchText(
  url: URL,
  expectedOrigin: string | null,
  deadline: AbortSignal,
  kind: FetchKind = "page",
) {
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    deadline.throwIfAborted();
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]);
    await assertPublicUrl(current, signal);
    if (expectedOrigin !== null && current.origin !== expectedOrigin)
      throw new Error("Documentation redirected to another website.");
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "FeedInDocs/1.0",
        Accept: ACCEPT[kind],
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Documentation returned an invalid redirect.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Documentation returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    if (!acceptsType(kind, type)) throw new Error("This URL did not return a documentation page.");
    const maxBytes = kind === "sitemap" ? MAX_SITEMAP_BYTES : MAX_BYTES;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new PageTooLargeError(current);
    const text = await readText(response, maxBytes, current);
    return { text, type, url: current };
  }
  throw new Error("Documentation redirected too many times.");
}

// The same-origin `Sitemap:` lines of `/robots.txt`, in file order. Keys are matched without
// case and `#` starts a comment. Only these lines are read: `Disallow` and the rest are ignored.
// A missing or unreadable robots.txt, or one served as HTML, gives none.
async function robotsSitemaps(start: URL, deadline: AbortSignal) {
  const robots = new URL("/robots.txt", start);
  const { text } = await fetchText(robots, start.origin, deadline, "robots");
  const sitemaps: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*sitemap\s*:\s*([^#\s]+)/i.exec(line);
    if (!match) continue;
    try {
      const url = new URL(match[1], robots);
      if (url.origin === start.origin) sitemaps.push(url.href);
    } catch {
      /* Ignore malformed sitemap lines. */
    }
  }
  return sitemaps;
}

// One sitemap file's same-origin nested sitemaps and page URLs, each in file order. Page URLs
// lose their hash and query. A sitemap that fails gives neither; one the deadline stopped gives
// null.
async function readSitemap(href: string, start: URL, deadline: AbortSignal) {
  const children: string[] = [];
  const pages: string[] = [];
  try {
    const { text } = await fetchText(new URL(href), start.origin, deadline, "sitemap");
    const $ = load(text, { xmlMode: true });
    $("sitemap > loc").each((_, element) => {
      try {
        const url = new URL($(element).text());
        if (url.origin === start.origin) children.push(url.href);
      } catch {
        /* Ignore malformed sitemap entries. */
      }
    });
    $("url > loc").each((_, element) => {
      try {
        const url = new URL($(element).text());
        url.hash = "";
        url.search = "";
        if (url.origin === start.origin) pages.push(url.href);
      } catch {
        /* Ignore malformed sitemap entries. */
      }
    });
  } catch (error) {
    if (error === deadline.reason) return null;
    /* Link crawling still works when no sitemap is available. */
  }
  return { children, pages };
}

// Every same-origin page URL in the sitemaps, in sitemap order. The caller filters by scope.
// robots.txt is read first, alone. The walk then starts from its sitemaps, then `/sitemap.xml`,
// and goes breadth-first, one level at a time: a level's files load SITEMAP_CONCURRENCY at a
// time, and the next level is their nested sitemaps in path order, skipping files already read.
// A file's path is its parent's path plus its index in the parent, so a level built from its
// parents in order, each parent's children in file order, is already sorted by path. Pages merge
// in that same order, never by completion order.
// At most MAX_SITEMAP_FILES files are read, admitted in that order. `cutOff` is true when the
// deadline or that cap stopped the walk with sitemaps still unread.
async function sitemapPages(start: URL, deadline: AbortSignal) {
  let declared: string[] = [];
  try {
    declared = await robotsSitemaps(start, deadline);
  } catch (error) {
    if (error === deadline.reason) return { pages: new Set<string>(), cutOff: true };
    /* Without a robots.txt, `/sitemap.xml` is still tried. */
  }
  const seen = new Set<string>();
  const pages = new Set<string>();
  let level = [...declared, new URL("/sitemap.xml", start).href];
  let cutOff = false;
  while (level.length && !cutOff) {
    const admitted: string[] = [];
    for (const href of level) {
      if (seen.has(href)) continue;
      if (seen.size === MAX_SITEMAP_FILES) {
        cutOff = true;
        break;
      }
      seen.add(href);
      admitted.push(href);
    }
    // Each result is stored at its file's index, so completion order can't reorder the merge.
    // A file the deadline stopped, or never started, stays null and stops the walk.
    const results = admitted.map((): Awaited<ReturnType<typeof readSitemap>> => null);
    let next = 0;
    async function lane() {
      while (next < admitted.length && !deadline.aborted) {
        const index = next++;
        results[index] = await readSitemap(admitted[index], start, deadline);
      }
    }
    await Promise.all(Array.from({ length: SITEMAP_CONCURRENCY }, lane));
    if (results.includes(null)) cutOff = true;
    level = [];
    for (const result of results) {
      if (!result) continue;
      for (const href of result.pages) pages.add(href);
      level.push(...result.children);
    }
  }
  return { pages, cutOff };
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// One cheerio parse per page. `links` holds every same-origin page link, in document order,
// and `alternate` the page's same-origin Markdown alternate; the caller checks both against the
// scope.
function parsePage(html: string, url: URL): Page {
  const $ = load(html);
  // Read from a copy without its permalink anchors, so the anchors' links are still collected.
  const heading = (selector: string) =>
    $(selector).first().clone().find(HEADING_ANCHORS).remove().end().text();
  const title = cleanTitle(
    heading("main h1") ||
      heading("h1") ||
      $("title").first().text() ||
      url.pathname.split("/").at(-1) ||
      url.hostname,
  );
  // Scoped to <head>: `$("title")` also matches the <title> inside every inline SVG.
  const headTitle = clean($("head > title").first().text());
  const applicationName = clean($('meta[name="application-name"]').attr("content") ?? "");
  const siteName = clean($('meta[property="og:site_name"]').attr("content") ?? "");
  const meta = $('meta[name="description"]').attr("content");
  const description = truncate(
    clean(meta || $("main p").first().text() || $("article p").first().text()),
    MAX_DESCRIPTION_LENGTH,
  );
  // Skips paragraphs inside the page chrome by their ancestors, so nothing is removed from the
  // page whose links are collected below.
  const firstParagraph = (selector: string) => {
    for (const element of $(selector).toArray()) {
      if ($(element).closest(PAGE_CHROME).length) continue;
      const text = clean($(element).text());
      if (text.length >= MIN_PARAGRAPH_LENGTH) return text;
    }
    return "";
  };
  const paragraph = truncate(
    firstParagraph("main p") || firstParagraph("article p"),
    MAX_DESCRIPTION_LENGTH,
  );
  let alternate: URL | null = null;
  const alternateHref = $('link[rel="alternate"][type="text/markdown"]').attr("href");
  if (alternateHref) {
    try {
      const next = new URL(alternateHref, url);
      if (next.origin === url.origin) alternate = next;
    } catch {
      /* Use the HTML URL. */
    }
  }
  const links = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const next = new URL(href, url);
      next.hash = "";
      next.search = "";
      if (
        next.origin === url.origin &&
        !/\.(png|jpg|jpeg|svg|pdf|zip|webp|gif|json|xml)$/i.test(next.pathname)
      )
        links.add(next.href);
    } catch {
      /* Ignore malformed links. */
    }
  });
  return {
    title,
    headTitle,
    applicationName,
    siteName,
    description,
    fromMeta: !!meta,
    paragraph,
    url,
    alternate,
    links: [...links],
  };
}

// Returns a start page too large to read instead of throwing, because the URL it landed on can
// still find a published llms.txt. Every other error ends the run.
function keepTooLarge(error: unknown) {
  if (error instanceof PageTooLargeError) return error;
  throw error;
}

// The site's own llms.txt for the docs at `anchor`, limited to the scope, or null when there's
// none worth using. The scope's file and the root file are fetched at once; the scope's file
// wins when it's used, and one that redirects to `/llms.txt` counts as the root file.
async function readPublished(anchor: URL, deadline: AbortSignal) {
  const scope = scopePath(anchor);
  const candidates = [
    ...(scope === "/" ? [] : [new URL(`${scope}llms.txt`, anchor)]),
    new URL("/llms.txt", anchor),
  ];
  const files = await Promise.all(
    candidates.map((url) => fetchText(url, anchor.origin, deadline, "llms").catch(() => null)),
  );
  for (const file of files) {
    if (!file) continue;
    const published = publishedLlmsTxt(
      file.text,
      file.url,
      anchor,
      file.url.pathname === "/llms.txt",
    );
    if (published) return { ...published, publishedUrl: file.url.href };
  }
  return null;
}

/**
 * Writes the index for the docs at `input`. A site that publishes a usable llms.txt gets that
 * file, limited to the scope (`mode: "published"`); `crawl: true` skips that check, and every
 * other site is crawled (`mode: "crawled"`). The run stops `budgetMs` after the call starts: the
 * route always uses RUN_BUDGET_MS, and the eval passes a larger one for slow replays. Then
 * `truncated` is true, and `unread` counts the in-scope pages found but not read.
 */
export async function generateLlmsTxt(
  input: string,
  { budgetMs = RUN_BUDGET_MS, crawl = false } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DeadlineError()), budgetMs);
  try {
    return await crawlSite(input, controller.signal, crawl);
  } finally {
    clearTimeout(timer);
  }
}

async function crawlSite(input: string, deadline: AbortSignal, crawlOnly: boolean) {
  let start: URL;
  try {
    start = new URL(input);
  } catch {
    throw new Error("Enter a valid documentation URL.");
  }
  await assertPublicUrl(start, deadline);
  start.hash = "";
  start.search = "";
  let failed = 0;
  let unread = 0;

  // The start page is read on its own because, with the sitemap, it decides whether a sparse
  // trailing-slash scope widens before the crawl begins. With `crawlOnly`, the sitemap is read
  // from the typed origin in parallel, and read again from the final origin only when the start
  // page redirected to another website. Otherwise the site's own llms.txt is checked once the
  // start page lands, and the sitemap is read only when that file isn't used.
  const [startResult, typedSitemap] = crawlOnly
    ? await Promise.all([fetchText(start, null, deadline), sitemapPages(start, deadline)])
    : [await fetchText(start, null, deadline).catch(keepTooLarge), null];
  // The run is anchored on where the start page landed: its origin is the crawl origin,
  // and its path picks the scope. `source` stays the typed URL so saved links keep their ID.
  const anchor = new URL(startResult.url);
  anchor.hash = "";
  anchor.search = "";
  if (!crawlOnly) {
    const published = await readPublished(anchor, deadline);
    if (published) {
      // A published file is read whole, so nothing is left unread.
      return {
        text: published.text,
        count: published.count,
        failed: 0,
        truncated: false,
        unread: 0,
        unreadIsLowerBound: false,
        mode: "published" as const,
        publishedUrl: published.publishedUrl,
        filtered: published.filtered,
        scope: published.scope,
        source: start.href,
      };
    }
  }
  // Only a published file can stand in for a start page too large to read.
  if (startResult instanceof PageTooLargeError) throw startResult;
  const { pages: sitemap, cutOff: sitemapCutOff } =
    anchor.origin === start.origin && typedSitemap
      ? typedSitemap
      : await sitemapPages(anchor, deadline);
  // Links on the start page resolve against the URL it landed on.
  const startPage = startResult.type.includes("text/markdown")
    ? null
    : parsePage(startResult.text, startResult.url);
  const candidates = [...new Set([...sitemap, ...(startPage?.links ?? [])])];
  const narrow = scopePath(anchor);
  const found = new Set(
    [anchor.href, ...candidates].filter((href) => inScope(new URL(href), narrow)),
  );
  const prefix = widenScope(anchor, found.size);

  // The start page is already read, under both the typed URL and the one it landed on.
  const startHrefs = new Set([start.href, anchor.href]);
  // Older version copies (`/docs/3.0.1/…` beside `/docs/…`) are skipped when the pool would
  // start them, so they're never fetched, and again when the entries are placed, which drops
  // any fetched before the filter turned on. Neither place counts them as unread.
  const versions = versionFilter(anchor, prefix, startHrefs);
  for (const href of startHrefs) versions.see(href);
  // Each page is queued once, under the first URL found for its key, so `/docs/x`, `/docs/x/`
  // and `/docs/x/index.html` are one page. `scheduled` maps a key to the URL it's queued under.
  // The filter sees only that first URL, so its counts are distinct pages.
  const scheduled = new Map([start, anchor].map((url) => [pageKey(url), url.href]));
  const queue: string[] = [];
  function schedule(href: string) {
    const key = pageKey(new URL(href));
    const known = scheduled.get(key);
    if (known) return known;
    scheduled.set(key, href);
    versions.see(href);
    queue.push(href);
    return href;
  }
  for (const href of candidates) if (inScope(new URL(href), prefix)) schedule(href);
  const seeds = queue.length;

  // A pool of CONCURRENCY slots: each takes the next queued URL as soon as its fetch
  // finishes, so no slot waits on the slowest page of a batch. `crawled` keeps each page
  // under the URL it was queued as, with only its in-scope links, in document order, each
  // rewritten to the URL its key is queued under.
  // A page whose redirects land outside the scope, or in an older version copy the filter
  // skips, is dropped, and its links aren't followed. It isn't counted as failed.
  // At the deadline, no new fetch starts, and a fetch it cut short counts as unread.
  const crawled = new Map<string, Page | null>();
  const landed = (page: Page | null | undefined) =>
    page && inScope(page.url, prefix) && !versions.skips(page.url.href) ? page : null;
  async function crawl(href: string) {
    let page: Page | null = null;
    try {
      const result = await fetchText(new URL(href), anchor.origin, deadline);
      if (!result.type.includes("text/markdown")) page = landed(parsePage(result.text, result.url));
    } catch (error) {
      if (error === deadline.reason) unread++;
      else failed++;
    }
    if (page)
      page.links = [
        ...new Set(page.links.filter((link) => inScope(new URL(link), prefix)).map(schedule)),
      ];
    crawled.set(href, page);
  }
  const inFlight = new Set<Promise<void>>();
  let next = 0;
  for (;;) {
    while (inFlight.size < CONCURRENCY && !deadline.aborted) {
      while (next < queue.length && versions.skips(queue[next])) next++;
      if (next === queue.length) break;
      const task: Promise<void> = crawl(queue[next++]).then(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }
    if (!inFlight.size) break;
    await Promise.race(inFlight);
  }
  // Queued and never started. The queue holds each page once, so this counts pages.
  unread += queue.slice(next).filter((href) => !versions.skips(href)).length;

  // Output order doesn't depend on which fetch finished first. It's a breadth-first walk of
  // the recorded links: the start page, the queue's seed (sitemap order, then the start
  // page's links), then each page's links in document order, skipping URLs already placed and
  // older version copies, by queued URL and by where the page landed. A skipped page's links
  // aren't followed.
  const order = queue.slice(0, seeds).filter((href) => !versions.skips(href));
  const placed = new Set([...startHrefs, ...order]);
  for (let i = 0; i < order.length; i++) {
    for (const link of landed(crawled.get(order[i]))?.links ?? []) {
      if (placed.has(link) || versions.skips(link)) continue;
      placed.add(link);
      order.push(link);
    }
  }
  // Pages that landed on the same key through redirects keep the first one placed. An entry
  // links the page's Markdown alternate when that's inside the scope, otherwise where the page
  // landed, and an entry whose link repeats an earlier one's is dropped.
  const listedKeys = new Set<string>();
  const listedUrls = new Set<string>();
  const entries: Array<{ page: Page; url: string }> = [];
  for (const page of [startPage, ...order.map((href) => landed(crawled.get(href)))]) {
    if (!page?.title) continue;
    const key = pageKey(page.url);
    const url =
      page.alternate && entryInScope(page.alternate, anchor.origin, prefix)
        ? page.alternate.href
        : page.url.href;
    if (listedKeys.has(key) || listedUrls.has(url)) continue;
    listedKeys.add(key);
    listedUrls.add(url);
    entries.push({ page, url });
  }
  if (!entries.length) throw new Error("No documentation pages were found at this URL.");
  const first = entries[0].page;
  const project = projectName({
    ...first,
    hostname: first.url.hostname,
    nextHeadTitle: entries[1]?.page.headTitle,
  });
  // The summary keeps the start page's meta description even when it's site-wide.
  const summary = first.description || `Documentation for ${project}.`;
  const descriptions = entryDescriptions(entries.map(({ page }) => page));
  const lines = [
    `# ${escapeMarkdown(project)}`,
    "",
    `> ${escapeMarkdown(summary)}`,
    "",
    "## Documentation",
    "",
  ];
  for (const [index, { page, url }] of entries.entries()) {
    // The colon is removed because `: ` separates the link from its description.
    const title = escapeMarkdown(truncate(page.title.replace(/\s*:+\s*/g, " "), MAX_TITLE_LENGTH));
    const description = descriptions[index] ? `: ${escapeMarkdown(descriptions[index])}` : "";
    lines.push(`- [${title}](${url})${description}`);
  }
  return {
    text: lines.join("\n").trim() + "\n",
    count: entries.length,
    failed,
    // True when the deadline left pages unread, or the deadline or the file cap stopped the
    // sitemaps before they all loaded.
    truncated: unread > 0 || sitemapCutOff,
    unread,
    // The sitemaps were cut off by the deadline or the file cap, so more pages may exist than
    // `unread` counts.
    unreadIsLowerBound: sitemapCutOff,
    mode: "crawled" as const,
    publishedUrl: null,
    filtered: false,
    scope: prefix,
    source: start.href,
  };
}
