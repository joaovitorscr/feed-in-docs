import { generateLlmsTxt } from "@/lib/generate";
import { saveLlmsTxt } from "@/lib/links";

export const runtime = "nodejs";

/** Just under Vercel's 4.5 MB function response limit, leaving room for the JSON around the text. */
const MAX_TEXT_BYTES = 4_400_000;

function errorMessage(error: unknown) {
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
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
    if (Buffer.byteLength(result.text) > MAX_TEXT_BYTES) {
      return Response.json(
        { error: "This site's index is too large. Try a narrower URL, like one docs section." },
        { status: 413 },
      );
    }
    const id = await saveLlmsTxt(result.text, source);
    const link = id ? `${new URL(request.url).origin}/l/${id}/llms.txt` : null;
    return Response.json({ ...result, link });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
