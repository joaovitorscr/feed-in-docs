# Feed in Docs

Paste a documentation URL and get an `llms.txt` index as a shareable link, or as text to copy or download. The app reads a site's sitemap and follows links to find HTML pages on the same origin and within the documentation section. There is no page-count cap. It uses a page's declared Markdown alternate URL when available and otherwise links to the HTML page.

## Run locally

```sh
corepack enable
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Links

Each result is saved to a private [Vercel Blob](https://vercel.com/docs/vercel-blob) store and served at `/l/<id>/llms.txt`. The ID comes from the documentation URL, so generating the same docs again refreshes the existing link. Links need `BLOB_READ_WRITE_TOKEN` in the environment. Without it, the app still generates text but returns no link.

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm check:react
```

This tool produces an index of links and descriptions, not a copy of the full documentation. Give the resulting link or text to your agent directly. Some sites require JavaScript to expose navigation, so they may yield fewer pages. The result reports pages that could not be read.
