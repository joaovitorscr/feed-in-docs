import { generateLlmsTxt } from "@/lib/generate";
import { SAVE_BUDGET_MS } from "@/lib/limits";
import { saveLlmsTxt } from "@/lib/links";

export const runtime = "nodejs";

// A literal, because Next reads it statically. It must stay at least 5 s above
// RUN_BUDGET_MS + SAVE_BUDGET_MS in lib/limits.ts (240 s + 20 s), so the crawl's own
// deadline answers before the platform's timeout does.
export const maxDuration = 300;

/** Just under Vercel's 4.5 MB function response limit, with headroom for the link. */
const MAX_RESPONSE_BYTES = 4_400_000;

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
  try {
    url = (await request.json()).url;
  } catch {
    return Response.json({ error: "Enter a documentation URL." }, { status: 400 });
  }
  if (typeof url !== "string" || url.length > 2048) {
    return Response.json({ error: "Enter a valid documentation URL." }, { status: 400 });
  }
  try {
    const { source, ...result } = await generateLlmsTxt(url);
    // Measured on the response body, where JSON escaping makes the text longer.
    if (Buffer.byteLength(JSON.stringify({ ...result, link: null })) > MAX_RESPONSE_BYTES) {
      return Response.json(
        { error: "This site's index is too large. Try a narrower URL, like one docs section." },
        { status: 413 },
      );
    }
    // One deadline for every storage call in this request, starting when the crawl ends.
    const id = await saveLlmsTxt(result.text, source, AbortSignal.timeout(SAVE_BUDGET_MS));
    const link = id ? `${new URL(request.url).origin}/l/${id}/llms.txt` : null;
    return Response.json({ ...result, link });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
