import { redirect } from "next/navigation";

import { readLlmsTxt } from "@/lib/links";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stream = await readLlmsTxt(id);
  if (!stream) {
    // A route handler can't render not-found.tsx. No route matches /l, so people browsing land on
    // the 404 page, while agents and scripts keep getting this plain-text 404.
    if (request.headers.get("sec-fetch-dest") === "document") redirect("/l");
    return new Response("Not found.\n", { status: 404 });
  }
  return new Response(stream, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
