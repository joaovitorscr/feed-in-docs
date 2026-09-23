# Feed in Docs

Paste a documentation URL and get a copyable `llms.txt` index. The app reads a site's sitemap and follows links to find HTML pages on the same origin and within the documentation section. There is no page-count cap. It uses a page's declared Markdown alternate URL when available and otherwise links to the HTML page.

## Run locally

```sh
corepack enable
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm check:react
```

This tool produces an index of links and descriptions, not a copy of the full documentation. Give the resulting text to your agent directly. Some sites require JavaScript to expose navigation, so they may yield fewer pages. The result reports pages that could not be read.
