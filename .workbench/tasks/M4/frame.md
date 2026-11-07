# M4 — Claude Code adapter (plus the M3-review must-fix)

## Goal

Milestone M4 (PLAN section 6 "Claude Code" + section 7 + M4): build
`src/adapters/claude-code` — a real harness adapter that registers the Parley MCP server at
user level, installs a Claude Code plugin (monitor + hooks), is idempotent, and `uninstall`s
exactly what it created. First, Step 1: fix the M3 review's must-fix on the fake adapter's
`uninstall` (recursive parent-dir delete) and fold in the other M3 follow-ups listed in
`state.json.next_action`.

## Facts (with receipts)

- **M3 must-fix** (state.json next_action, 2026-11-07): the fake adapter's `uninstall`
  (`src/adapters/fake/index.ts`) runs `rmSync(dirname(path), { recursive: true, force: true })`,
  which deletes the whole parent dir even if setup didn't create it or it holds other files.
  Fix: remove only what install created; remove a directory only if install created it and it is
  now empty. Real adapters copy this pattern into `~/.claude`, so it must be safe.
- **M3 other follow-ups** (state.json next_action): (a) a test through `buildProgram`/commander for
  `setup --dry-run` asserting the temp HOME is untouched; (b) error on an unknown `--format`;
  (c) a test of the `transport.onclose` close path (already added in M3 `test/mcp/serve.test.ts`
  "closes the hub db when stdin ends" — verify it covers the path, extend if needed); (d) record
  the `Adapter` interface deviation (`env`, `dryRun`, `fake`) and add "hooks trusted?" to
  `DoctorReport`; (e) trailing newline in `overlap.ts` (verify; M3 already tidied it).
- **Claude Code mechanisms verified** against code.claude.com/docs 2026-11-07, recorded in
  `docs/harness-notes.md` (M4 section): user MCP config in `~/.claude.json` `mcpServers`; plugin
  manifest `.claude-plugin/plugin.json`; hooks `hooks/hooks.json`; monitors `monitors/monitors.json`
  under `experimental.monitors`; monitor stdout reaches Claude as notifications (the idle-wake
  mechanism); hook payloads on stdin carry `session_id`, `cwd`, `prompt` (UserPromptSubmit),
  `tool_name`/`tool_input` (PostToolUse), `reason` (SessionEnd), and `agent_id`/`agent_type` for
  subagents; SessionStart runs before MCP servers so it must be a `command` hook.
- **CLI surface already present** (M3): `inbox drain|watch|register`, `hook edit`, `setup`,
  `uninstall`, `doctor`, all with injectable `{ write, env, cwd }` deps and a temp-HOME-friendly
  `AdapterEnv { home }`. The store exposes `agentsRepo`, `messagesRepo` (incl.
  `listUndeliveredForRecipient`, `requeueDeliveredForSession`, `guardedStatusUpdate`),
  `messageEventsRepo`, `editsRepo` — reused, not duplicated (AGENTS.md: search before adding).
- **Read evidence** (PLAN 4.3): a message is read when its id is seen in the model's input
  (UserPromptSubmit prompt), when the recipient calls `inbox`, or when it replies. M4 adds the
  UserPromptSubmit evidence path.
- Layer rule (AGENTS.md): `adapters` -> `core` -> `store`; no file over 400 lines; no `any`,
  no `as` (only `as const`); Zod-parse every boundary (hook payload JSON, config JSON files).

## Design (builder decisions, all testable)

- **Hook logic lives in TypeScript, not shell.** The plugin ships tiny scripts that pipe their
  stdin JSON into `parley-mcp hook <event>`. New CLI subcommands `hook session-start`,
  `hook user-prompt`, `hook stop`, `hook post-tool`, `hook session-end` each read the payload from
  stdin, Zod-parse it, **ignore any payload carrying `agent_type`/`agent_id` (subagent)**, and do
  the work (register/heartbeat, read-evidence, drain, requeue). `hook edit` stays as is; PostToolUse
  for Edit/Write also records the edit. This keeps the acceptance checks ("subagent payloads
  ignored", "UserPromptSubmit marks read") as pure function tests with synthetic payloads.
- **Adapter install** writes two things, both user-level, both merge-not-overwrite and idempotent:
  1. `~/.claude.json` -> merge `mcpServers.parley = { command: "npx", args: ["parley-mcp","serve"] }`.
  2. a plugin dir under `~/.claude/plugins/parley/` with `.claude-plugin/plugin.json`,
     `hooks/hooks.json`, `monitors/monitors.json`, and `scripts/` (one script per event + monitor).
     Plugin files are generated from constants; install writes them only if missing or different.
- **uninstall** removes exactly the files/keys install created, and removes a directory only if it
  is now empty (shared helper so the fake adapter uses the same safe logic).
- **Fixtures** `src/adapters/claude-code/fixtures/*.json` are synthetic (marked `_synthetic`), for
  replay tests until the human captures real payloads.

## Allowed / forbidden paths

Allowed: `src/adapters/**`, `src/cli/**`, `src/core/**`, `src/store/**`, `test/**`,
`docs/PROGRESS.md`, `docs/harness-notes.md`, `.workbench/**`.
Forbidden: `src/viewer/**`, `src/notify/**`, `src/mcp/**` (M2, untouched this milestone except if a
shared read-evidence helper must move to core — kept in core instead), `package.json`
(no new deps needed), and the global forbidden list (secrets, `.git/**`).

## Acceptance

- `pnpm check` (lint + typecheck + vitest) passes.
- Fake adapter uninstall: a test where the config's parent dir already holds an unrelated file
  proves uninstall leaves that file and the dir intact (only the created file/key is removed).
- Claude Code install into a temp HOME produces the expected `~/.claude.json` `mcpServers.parley`
  entry and the plugin files (manifest, hooks.json, monitors.json, scripts).
- Install twice is a no-op (byte-for-byte identical the second time).
- Uninstall leaves pre-existing files byte for byte (both the merged `~/.claude.json` other keys
  and any pre-existing unrelated files/dirs).
- A subagent hook payload (`agent_type` present) is ignored by every hook handler.
- Read evidence: a `UserPromptSubmit` payload whose prompt contains a delivered message's id marks
  that message `read`.
- `doctor` reports each check (installed? MCP wired? plugin present? can wake idle?).
- All tests use a temporary HOME; the real `~/.claude` is never touched and `claude` is never run.
- `wb verify` passes.

## Unknowns

- discoverable: exact plugin/hook/monitor JSON shapes — resolved from code.claude.com/docs
  (recorded in harness-notes.md).
- decidable: the plugin directory path under `~/.claude` and the script wrapper contents —
  builder's choice, tested against a temp HOME.
- human: the live two-session test (idle session answers within 5 s, read receipts, real fixtures)
  stays with the human — PLAN marks M4's acceptance (H). Written up in PROGRESS.md as exact steps.
- deferred: Codex/Cursor/Grok adapters (M5/M8/M9); real captured fixtures replace the synthetic ones
  during the human test.
