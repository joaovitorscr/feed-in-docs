import { redirect } from "next/navigation";
import { after } from "next/server";

import { readLlmsTxt } from "@/lib/links";
import { checkLink, shouldCheck } from "@/lib/refresh";

export const runtime = "nodejs";

// A literal, because Next reads it statically. It matches POST /api/generate, because a stale
// link's read refreshes it in `after()` under this limit (see lib/refresh.ts). Normal reads still
// take milliseconds.
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestStart = Date.now();
  const { id } = await params;
  const saved = await readLlmsTxt(id);
  if (!saved) {
    // A route handler can't render not-found.tsx. No route matches /l, so people browsing land on
    // the 404 page, while agents and scripts keep getting this plain-text 404.
    if (request.headers.get("sec-fetch-dest") === "document") redirect("/l");
    return new Response("Not found.\n", { status: 404 });
  }
  // The text is served as is. A stale copy refreshes after the response, for later reads.
  if (shouldCheck(id, saved.uploadedAt)) {
    const servedEtag = saved.blob.etag;
    after(() => checkLink(id, servedEtag, requestStart));
  }
  return new Response(saved.stream, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Content-Type": "text/plain; charset=utf-8",
      // The link's true age: when its text was last written.
      ...(saved.uploadedAt && { "Last-Modified": saved.uploadedAt.toUTCString() }),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
