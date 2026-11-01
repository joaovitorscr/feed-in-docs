# Feed In Docs

Feed In Docs is a small application to convert documentation websites into llms.txt format to feed AI Agents.

## Ways to hurt yourself

1. Killing by pattern. Never pkill -f, pgrep | kill, or kill a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once.

## Development Servers

Run development commands from the repository root

- `pnpm dev` runs the the development server

## Verifying

- Use the smallest proof that the change works.
- Always lint before commiting.

## Pull Requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as .github/pr-assets/, and never push branches just to host them.
  - Use `--attach` on `gh pr create`, `gh pr edit`, or `gh pr comment`. Repeat it per file and add alt text after `#`: `gh pr edit 49 --attach './before.png#Go card before' --attach ./after.png`.
  - To place images in the body, reference them by relative path (`![Before](./before.png)`) and pass the same files with `--attach`. gh uploads them and rewrites the references to `github.com/user-attachments` URLs. Without a body reference, the attachment is appended to the end.
  - Run gh from the directory the relative paths resolve against. Keep the files outside the worktree, for example in /tmp.
- One concern per PR. If the description says "also", split it.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. .plans/ is gitignored only as a safety net for legacy tooling.
- Put durable architecture, constraints, and decisions in docs/internals/. Update those docs when the product changes so agents find current facts instead of abandoned intentions.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## Taste

- Inferred types over annotations. any is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users are most of the time developers and people that pay attentions to little details and will notice fps drops, lying spinner, stale labels. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
- All the components used should be from shadcn, from shadcn registry at components.json or a custom built component we approved you to create with base-ui.

## Additional Tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
