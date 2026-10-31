import { generateLlmsTxt } from "@/lib/generate";
import { saveLlmsTxt } from "@/lib/links";

export const runtime = "nodejs";

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
    const id = await saveLlmsTxt(result.text, source);
    const link = id ? `${new URL(request.url).origin}/l/${id}/llms.txt` : null;
    return Response.json({ ...result, link });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read this documentation website.";
    return Response.json({ error: message }, { status: 400 });
  }
}
