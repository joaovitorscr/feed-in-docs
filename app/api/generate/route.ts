import { SAVE_BUDGET_MS } from "@/lib/limits";
import { generateAndSave } from "@/lib/links";

export const runtime = "nodejs";

// A literal, because Next reads it statically. It must stay at least 5 s above
// RUN_BUDGET_MS + SAVE_BUDGET_MS in lib/limits.ts (240 s + 20 s), so the crawl's own
// deadline answers before the platform's timeout does, and equal MAX_DURATION_MS there.
export const maxDuration = 300;

function errorMessage(error: unknown) {
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError", "DeadlineError"].includes(error.name)
  ) {
    return "This website took too long to respond. Try again in a moment.";
  }
  // undici reports every connection and TLS failure as `TypeError: fetch failed`.
  if (error instanceof TypeError) {
    return "Could not connect to this website. Check the URL and try again.";
  }
  return error instanceof Error ? error.message : "Could not read this documentation website.";
}

export async function POST(request: Request) {
  let url: unknown;
  let crawl: unknown;
  try {
    ({ url, crawl } = await request.json());
  } catch {
    return Response.json({ error: "Enter a documentation URL." }, { status: 400 });
  }
  if (typeof url !== "string" || url.length > 2048) {
    return Response.json({ error: "Enter a valid documentation URL." }, { status: 400 });
  }
  try {
    // `crawl: true` skips the site's own llms.txt and reads the pages instead. A submit writes
    // the text and the record unconditionally, so it always wins over a background refresh.
    const outcome = await generateAndSave(url, crawl === true ? "crawl" : "auto", {
      // One deadline for every storage call in this request (the text, then its record),
      // starting when the crawl ends.
      storage: () => AbortSignal.timeout(SAVE_BUDGET_MS),
    });
    // Without conditional writes or a reject rule, the only rejection is the size check.
    if (outcome.status === "rejected") {
      return Response.json(
        { error: "This site's index is too large. Try a narrower URL, like one docs section." },
        { status: 413 },
      );
    }
    const { source: _, ...result } = outcome.result;
    const link = outcome.id ? `${new URL(request.url).origin}/l/${outcome.id}/llms.txt` : null;
    return Response.json({ ...result, link });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
