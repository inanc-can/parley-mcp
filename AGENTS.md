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

## Workbench in OpenCode runs

OpenCode doesn't run the workbench's Claude Code hooks, so in OpenCode follow the workbench loop
below yourself:
- Don't ask for a working mode. At the start of a milestone run
  `python3 /Users/inanccan/.claude/workbench/bin/wb.py mode checkpoints --session opencode-<milestone>`
  (for example `opencode-M1`): checkpoints means stop at the end of each milestone.
- Frame each milestone as a workbench task (`wb task start M<n>`), run commands through `wb run -- <cmd>`,
  and finish with `wb verify`. A milestone is done only when `wb verify` passes.
- Never edit `.workbench/config.json` or `.workbench/rules.md`. Before stopping, update `state.json`
  and run `wb handoff`.

<!-- workbench:begin -->
## Agent workbench

This repo runs with an agent workbench. The repo is the system of record, not the chat.

Read first:
1. `.workbench/state.json`: where the last session stopped and its `next_action`.
2. `.workbench/rules.md`: startup, forbidden, done, uncertainty, approval.
3. The active task's `.workbench/tasks/<id>/scope.json` (allowed/forbidden files, acceptance).

Verify command (full suite):
   - `pnpm check`

Working mode: at the start of every session, ask the user how to work (autonomous /
checkpoints / supervised, or their own words) and record it with `wb mode`. Code edits are
blocked until you do. Follow that mode for the whole session.

Loop for non-trivial work:
1. Frame: goal, facts with receipts, allowed/forbidden paths, acceptance, unknowns
   -> `.workbench/tasks/<id>/frame.md` + `scope.json`, then `wb task start <id>`.
2. Plan: work items with evidence, dependencies and proof -> `plan.json`, then `wb plan check`.
3. Build inside scope. Run commands through `wb run -- <cmd>` so results are logged.
4. Verify: `wb verify`. Never claim done without a passing verdict.
5. Review: a separate reviewer reads the diff and verdict; the builder doesn't grade itself.
6. Handoff: update `summary`, `next_action`, `blockers` in state.json, then `wb handoff`.
7. A correction from a human becomes a durable control (test > scope > automation >
   example > instruction), logged with `wb ratchet add`.

`wb` = `python3 /Users/inanccan/.claude/workbench/bin/wb.py`
<!-- workbench:end -->
