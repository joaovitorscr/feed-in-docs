import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { inScope, scopePath, widenScope } from "@/lib/scope";
import { escapeMarkdown, truncate } from "@/lib/text";

const MAX_BYTES = 1_000_000;
const MAX_SITEMAP_BYTES = 10_000_000;
const TIMEOUT_MS = 8_000;
const CONCURRENCY = 8;
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 180;

type Page = {
  title: string;
  project: string;
  description: string;
  outputUrl: string;
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

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Enter a public HTTP or HTTPS documentation URL.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Enter a public documentation URL.");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new Error("Could not find this website. Check the URL and try again.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Enter a public documentation URL.");
  }
}

// Decodes the body as UTF-8, like `response.text()`, but counts bytes as they arrive and
// cancels the download once it passes `maxBytes`, whatever `content-length` claimed.
async function readText(response: Response, maxBytes: number) {
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
      throw new Error("A documentation page is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

// Follows up to 3 redirects by hand, checking every hop. Pass `expectedOrigin: null` only
// for the start page, which may redirect to another website; every other fetch stays on it.
async function fetchText(url: URL, expectedOrigin: string | null, sitemap = false) {
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    await assertPublicUrl(current);
    if (expectedOrigin !== null && current.origin !== expectedOrigin)
      throw new Error("Documentation redirected to another website.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "FeedInDocs/1.0",
        Accept: sitemap ? "application/xml, text/xml" : "text/html",
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
    if (
      !type.includes("text/html") &&
      !type.includes("text/markdown") &&
      !(sitemap && (type.includes("xml") || type.includes("text/plain")))
    )
      throw new Error("This URL did not return a documentation page.");
    const maxBytes = sitemap ? MAX_SITEMAP_BYTES : MAX_BYTES;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new Error("A documentation page is too large.");
    const text = await readText(response, maxBytes);
    return { text, type, url: current };
  }
  throw new Error("Documentation redirected too many times.");
}

// Every same-origin page URL in the sitemaps, in sitemap order. The caller filters by scope.
async function sitemapPages(start: URL) {
  const sitemapQueue = [new URL("/sitemap.xml", start).href];
  const seenSitemaps = new Set<string>();
  const pages = new Set<string>();
  while (sitemapQueue.length) {
    const href = sitemapQueue.shift()!;
    if (seenSitemaps.has(href)) continue;
    seenSitemaps.add(href);
    try {
      const { text } = await fetchText(new URL(href), start.origin, true);
      const $ = load(text, { xmlMode: true });
      $("sitemap > loc").each((_, element) => {
        try {
          const url = new URL($(element).text());
          if (url.origin === start.origin && !seenSitemaps.has(url.href))
            sitemapQueue.push(url.href);
        } catch {
          /* Ignore malformed sitemap entries. */
        }
      });
      $("url > loc").each((_, element) => {
        try {
          const url = new URL($(element).text());
          url.hash = "";
          url.search = "";
          if (url.origin === start.origin) pages.add(url.href);
        } catch {
          /* Ignore malformed sitemap entries. */
        }
      });
    } catch {
      /* Link crawling still works when no sitemap is available. */
    }
  }
  return pages;
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// One cheerio parse per page. `links` holds every same-origin page link, in document order,
// and the caller filters them by scope. `outputUrl` is the URL the entry links to: a same-origin
// `<link rel="alternate" type="text/markdown">` when the page declares one, otherwise `url`.
function parsePage(html: string, url: URL): Page {
  const $ = load(html);
  const title = clean(
    $("main h1").first().text() ||
      $("h1").first().text() ||
      $("title").first().text() ||
      url.pathname.split("/").at(-1) ||
      url.hostname,
  );
  // Scoped to <head>: `$("title")` also matches the <title> inside every inline SVG.
  const project = clean($("head > title").first().text().split("|").at(-1) || "") || url.hostname;
  const description = truncate(
    clean(
      $('meta[name="description"]').attr("content") ||
        $("main p").first().text() ||
        $("article p").first().text(),
    ),
    MAX_DESCRIPTION_LENGTH,
  );
  let outputUrl = url.href;
  const alternate = $('link[rel="alternate"][type="text/markdown"]').attr("href");
  if (alternate) {
    try {
      const next = new URL(alternate, url);
      if (next.origin === url.origin) outputUrl = next.href;
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
  return { title, project, description, outputUrl, links: [...links] };
}

export async function generateLlmsTxt(input: string) {
  let start: URL;
  try {
    start = new URL(input);
  } catch {
    throw new Error("Enter a valid documentation URL.");
  }
  await assertPublicUrl(start);
  start.hash = "";
  start.search = "";
  let failed = 0;

  // The start page is read on its own, next to the sitemap, because together they
  // decide whether a sparse trailing-slash scope widens before the crawl begins.
  // The sitemap is read from the typed origin in parallel, and read again from the
  // final origin only when the start page redirected to another website.
  const [startResult, typedSitemap] = await Promise.all([
    fetchText(start, null),
    sitemapPages(start),
  ]);
  // The crawl is anchored on where the start page landed: its origin is the crawl origin,
  // and its path picks the scope. `source` stays the typed URL so saved links keep their ID.
  const anchor = new URL(startResult.url);
  anchor.hash = "";
  anchor.search = "";
  const sitemap = anchor.origin === start.origin ? typedSitemap : await sitemapPages(anchor);
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
  const queue = candidates.filter(
    (href) => !startHrefs.has(href) && inScope(new URL(href), prefix),
  );
  const seeds = queue.length;
  const scheduled = new Set([...startHrefs, ...queue]);

  // A pool of CONCURRENCY slots: each takes the next queued URL as soon as its fetch
  // finishes, so no slot waits on the slowest page of a batch. `crawled` keeps each page
  // under the URL it was queued as, with only its in-scope links, in document order.
  const crawled = new Map<string, Page | null>();
  async function crawl(href: string) {
    let page: Page | null = null;
    try {
      const result = await fetchText(new URL(href), anchor.origin);
      if (!result.type.includes("text/markdown")) page = parsePage(result.text, result.url);
    } catch {
      failed++;
    }
    if (page) page.links = page.links.filter((link) => inScope(new URL(link), prefix));
    crawled.set(href, page);
    for (const link of page?.links ?? []) {
      if (scheduled.has(link)) continue;
      scheduled.add(link);
      queue.push(link);
    }
  }
  const inFlight = new Set<Promise<void>>();
  let next = 0;
  while (next < queue.length || inFlight.size) {
    while (inFlight.size < CONCURRENCY && next < queue.length) {
      const task: Promise<void> = crawl(queue[next++]).then(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }
    await Promise.race(inFlight);
  }

  // Output order doesn't depend on which fetch finished first. It's a breadth-first walk of
  // the recorded links: the start page, the queue's seed (sitemap order, then the start
  // page's links), then each page's links in document order, skipping URLs already placed.
  const order = queue.slice(0, seeds);
  const placed = new Set([...startHrefs, ...order]);
  for (let i = 0; i < order.length; i++) {
    for (const link of crawled.get(order[i])?.links ?? []) {
      if (placed.has(link)) continue;
      placed.add(link);
      order.push(link);
    }
  }
  const pages = [startPage, ...order.map((href) => crawled.get(href))].filter(
    (page): page is Page => !!page?.title,
  );
  if (!pages.length) throw new Error("No documentation pages were found at this URL.");
  const project = pages[0].project;
  const summary = pages[0].description || `Documentation for ${project}.`;
  const lines = [
    `# ${escapeMarkdown(project)}`,
    "",
    `> ${escapeMarkdown(summary)}`,
    "",
    "## Documentation",
    "",
  ];
  for (const page of pages) {
    // The colon is removed because `: ` separates the link from its description.
    const title = escapeMarkdown(truncate(page.title.replace(/\s*:+\s*/g, " "), MAX_TITLE_LENGTH));
    const description = page.description ? `: ${escapeMarkdown(page.description)}` : "";
    lines.push(`- [${title}](${page.outputUrl})${description}`);
  }
  return {
    text: lines.join("\n").trim() + "\n",
    count: pages.length,
    failed,
    source: start.href,
  };
}
