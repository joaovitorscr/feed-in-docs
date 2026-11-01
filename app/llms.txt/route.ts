import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** This site's own llms.txt. Saved results live at `/l/<id>/llms.txt`. */
export function GET() {
  const text = `# Feed in Docs

> ${SITE_DESCRIPTION}

To generate an index without the web app, send a POST request to ${SITE_URL}/api/generate with the JSON body \`{ "url": "https://example.com/docs" }\`. The result lists links and one-line descriptions, not page content.

## Docs

- [Web app](${SITE_URL}): Paste a documentation URL and copy, link to, or download the generated llms.txt.
- [README](https://raw.githubusercontent.com/joaovitorscr/feed-in-docs/main/README.md): How the crawler works, the API response format, crawl limits, and how to run the app locally.
`;
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
