# M5 — Codex adapter

## Goal

Build `src/adapters/codex` (PLAN section 6 "Codex" + M5): register the Parley MCP server at user
level in `~/.codex/config.toml` under `[mcp_servers.mcp-parley]` (merged with `smol-toml`, keeping
comments and every other table), write Codex lifecycle hooks to `~/.codex/hooks.json` (SessionStart,
UserPromptSubmit, PostToolUse, Stop, SessionEnd — the same register / read-evidence / edit / requeue
roles as Claude Code), and an app-server idle-wake client (`turn/start` for an idle thread,
`turn/steer` with `expectedTurnId` for a busy one) that is **gated to the verified protocol and fails
closed** — when the app-server is unreachable it reports "queued until the next turn" in `outlook`
and falls back to the hooks + MCP inbox. Idempotent install, exact (byte-for-byte) uninstall, and a
`doctor` that reports when hooks are untrusted. Reuse every M4 pattern the live test proved.

## Facts (receipts)

- `codex-cli 0.154.0` installed (`codex --version`). Protocol schema generated with
  `codex app-server generate-json-schema --out dist/codex-schema` (gitignored). Verified method
  shapes: `TurnStartParams { threadId, input }`, `TurnSteerParams { threadId, expectedTurnId, input }`,
  `InitializeParams { clientInfo }` → `InitializeResponse { codexHome, platformFamily, platformOs,
  userAgent }`, error `activeTurnNotSteerable`. (`dist/codex-schema/v2/*.json`, `v1/Initialize*.json`.)
- MCP servers live in `~/.codex/config.toml` `[mcp_servers.<name>]` (official docs + `codex mcp`).
- Hooks live in `~/.codex/hooks.json` or inline `[hooks]`; event names PascalCase; handler
  `{ type:"command", command, timeout? }`; `UserPromptSubmit`/`Stop` ignore matcher; non-managed
  hooks need trust via the interactive `/hooks` (no non-interactive `codex hooks` subcommand).
  Payload stdin fields match Claude's (`session_id`, `cwd`, `hook_event_name`, `prompt`, `tool_input`,
  `source`, `reason`). (learn.chatgpt.com/docs/hooks, fetched 2026-11-07.) Full detail in
  `docs/harness-notes.md` M5 section.
- M4 proved patterns to reuse: absolute launcher (never npx, `src/adapters/cli-path.ts`), MCP key
  `mcp-parley`, never overwrite/remove a foreign entry, identity bound to the harness session
  (`PARLEY_HARNESS` env → `codex@<folder>`), monitor/drain lines carry the message id + a reply hint,
  heartbeat on every poll (`inbox drain` touches liveness). (`src/adapters/claude-code/*`,
  `src/cli/commands/inbox.ts`, `docs/PROGRESS.md` M4 live-test notes.)

## Allowed / forbidden paths

Allowed: `src/adapters/**`, `src/cli/**`, `src/mcp/**`, `test/**`, `docs/PROGRESS.md`,
`docs/harness-notes.md`, `.workbench/**`, `package.json` (+ `pnpm-lock.yaml` for the smol-toml add).
Forbidden: `src/viewer/**`, `src/notify/**`, `src/core/**`, `src/store/**`, `docs/PLAN.md`.

## Acceptance

- `pnpm check` (lint strict + tsc + vitest) passes.
- Install into a temp HOME merges `config.toml` without losing other content; install twice is a
  no-op (byte for byte); uninstall restores it byte for byte; a foreign `[mcp_servers.mcp-parley]`
  entry is left alone (not overwritten, not removed).
- The app-server client builds correct `turn/start` and `turn/steer` requests against the generated
  schema; the fail-closed fallback (unreachable / wrong version → queued-until-next-turn) is tested.
- `doctor` reports each check (config present, hooks present, hooks-trust unknown-until-/hooks,
  app-server reachable) and never falsely claims hooks are trusted.
- Fixtures replay through the Codex hook handlers (synthetic, `_synthetic: true`).

## Unknowns

- discoverable/decidable: exact TOML merge edge cases (comments, nested env table) — covered by
  smol-toml round-trip tests; hook handler reuse vs. Codex-specific wrappers — decided by reading the
  verified payload fields.
- human: the real idle round trip, trusting hooks via `/hooks`, capturing real fixtures — M5 is
  marked (H) in PLAN; the build ships synthetic fixtures + exact live-test steps and stops for the
  human. All tests use a temp HOME and fake runners/sockets; never touch the real `~/.codex`, never
  start a codex session.
- deferred: wiring the live app-server `threadId`/`turnId` to the agent id (gated + fail-closed until
  the human's run confirms it).
