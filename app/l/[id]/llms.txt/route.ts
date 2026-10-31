import { readLlmsTxt } from "@/lib/links";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stream = await readLlmsTxt(id);
  if (!stream) return new Response("Not found.\n", { status: 404 });
  return new Response(stream, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
