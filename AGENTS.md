# Parley MCP: instructions for the building agent

You are building **Parley MCP**, a free, open-source tool that lets a developer's coding agents
(Claude Code, Codex, Cursor, Grok Build) find each other, message each other, and settle
disagreements with written agreements, all on one machine with the human watching.

The full specification is in [`docs/PLAN.md`](docs/PLAN.md). Read all of it before writing code.
Every product decision in it is final. Do not redecide them; if one turns out impossible, stop and
ask the human (see "When to stop").

## How to work

1. Work **one milestone at a time**, in the order in `docs/PLAN.md`. Do not start the next
   milestone until every acceptance check of the current one passes.
2. Before starting a milestone, write a short plan for it at the top of `docs/PROGRESS.md`
   (create the file in M0). After finishing, record what you built, the commands you ran, and their
   results.
3. Keep `docs/harness-notes.md` up to date with everything you learn about a harness: versions,
   hook payloads, config paths, and what you verified versus what you assumed.
4. Commit after each completed task with a Conventional Commit message (`feat:`, `fix:`, `test:`,
   `docs:`, `chore:`). Never push and never publish to npm; the human does that.
5. Run `pnpm check` (lint + typecheck + test) before every commit. It must pass.

## Coding rules (CI enforces these)

- TypeScript `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **No `any`. No `as` type assertions** (only `as const`). Narrow unknown input with Zod `.parse()`
  right where it enters: DB rows, hook payloads, MCP arguments, JSON files.
- **No file over 400 lines.** Split early.
- Layers point one way: `cli` / `mcp` / `adapters` / `viewer` → `core` → `store`. `core` is pure
  logic with no I/O and is fully unit-tested.
- kebab-case filenames, camelCase functions, PascalCase types, UPPER_CASE constants.
- Search for an existing helper before adding a new one.
- Every behaviour you add gets a test. Tests use an in-memory SQLite database.

## Hard limits (never do these)

- No network calls from the tool, except the viewer listening on `127.0.0.1`. No telemetry code
  until the human says so (milestone M11 explains why).
- Never write into the user's repositories during setup. Only user-level config files (see PLAN.md).
- Never store or log message content anywhere except the local SQLite file.
- Never read, print or commit secrets, `.env` files or API keys.
- Don't copy code from other projects. Concord (`github.com/Get-Concord-AI/concord-mcp`, MIT) is a
  **reference** for how harnesses can be woken: read it to learn the mechanism, then write your own
  code. If you ever copy a snippet longer than a few lines, keep its MIT notice and record it in
  `docs/harness-notes.md`.

## When to stop and ask the human

Stop, write the question at the top of `docs/PROGRESS.md`, and wait when:
- a harness can't do what PLAN.md needs (for example it can't wake an idle session),
- a step needs the human: trusting hooks, restarting a harness, logging in, testing with two real
  agent sessions, choosing the npm package name, publishing,
- you would need a new dependency that isn't listed in PLAN.md,
- an acceptance check still fails after three honest attempts.
