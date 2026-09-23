import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_PAGES = 40;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;

type Page = { title: string; project: string; description: string; url: string; links: string[] };

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
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Enter a public documentation URL.");
  }
}

async function fetchText(url: URL, expectedOrigin: string) {
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    await assertPublicUrl(current);
    if (current.origin !== expectedOrigin)
      throw new Error("Documentation redirected to another website.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "FeedInDocs/1.0", Accept: "text/html" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Documentation returned an invalid redirect.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Documentation returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("text/markdown"))
      throw new Error("This URL did not return a documentation page.");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("A documentation page is too large.");
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("A documentation page is too large.");
    return { text, type, url: current };
  }
  throw new Error("Documentation redirected too many times.");
}

function clean(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[[\]<>]/g, "")
    .trim();
}

function scopePath(url: URL) {
  const path = url.pathname.replace(/\/$/, "");
  const last = path.split("/").at(-1)?.toLowerCase();
  if (!path || path === "/") return "/";
  if (last === "docs" || last === "documentation") return path + "/";
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function parsePage(html: string, url: URL, prefix: string): Page {
  const $ = load(html);
  const title = clean(
    $("main h1").first().text() ||
      $("h1").first().text() ||
      $("title").first().text() ||
      url.pathname.split("/").at(-1) ||
      url.hostname,
  );
  const project = clean($("title").text().split("|").at(-1) || "") || url.hostname;
  const description = clean(
    $('meta[name="description"]').attr("content") ||
      $("main p").first().text() ||
      $("article p").first().text(),
  ).slice(0, 180);
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
        next.pathname.startsWith(prefix) &&
        !/\.(png|jpg|jpeg|svg|pdf|zip|webp|gif|json|xml)$/i.test(next.pathname)
      )
        links.add(next.href);
    } catch {
      /* Ignore malformed links. */
    }
  });
  return { title, project, description, url: url.href, links: [...links] };
}

function markdownUrl(html: string, url: URL) {
  const $ = load(html);
  const alternate = $('link[rel="alternate"][type="text/markdown"]').attr("href");
  if (alternate) {
    try {
      const next = new URL(alternate, url);
      if (next.origin === url.origin) return next.href;
    } catch {
      /* Use the HTML URL. */
    }
  }
  return url.href;
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
  const prefix = scopePath(start);
  const queue = [start.href];
  const seen = new Set<string>();
  const pages: Array<Page & { outputUrl: string }> = [];

  while (queue.length && seen.size < MAX_PAGES) {
    const batch: string[] = [];
    while (queue.length && batch.length < 5 && seen.size < MAX_PAGES) {
      const href = queue.shift()!;
      if (seen.has(href)) continue;
      seen.add(href);
      batch.push(href);
    }
    const results = await Promise.all(
      batch.map(async (href) => {
        try {
          const result = await fetchText(new URL(href), start.origin);
          if (result.type.includes("text/markdown")) return null;
          const page = parsePage(result.text, result.url, prefix);
          return { ...page, outputUrl: markdownUrl(result.text, result.url) };
        } catch (error) {
          if (href === start.href) throw error;
          return null;
        }
      }),
    );
    for (const page of results) {
      if (!page) continue;
      if (page.title) pages.push(page);
      for (const link of page.links) if (!seen.has(link) && !queue.includes(link)) queue.push(link);
    }
  }
  if (!pages.length) throw new Error("No documentation pages were found at this URL.");
  const project = pages[0].project;
  const summary = pages[0].description || `Documentation for ${project}.`;
  const lines = [`# ${project}`, "", `> ${summary}`, "", "## Documentation", ""];
  for (const page of pages) {
    const title = page.title.replace(/[:\n]/g, " ").slice(0, 100);
    const description = page.description ? `: ${page.description}` : "";
    lines.push(`- [${title}](${page.outputUrl})${description}`);
  }
  return {
    text: lines.join("\n").trim() + "\n",
    count: pages.length,
    limited: seen.size >= MAX_PAGES,
  };
}
