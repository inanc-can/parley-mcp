# Harness notes

Record verified harness details here: versions, hook payloads, config paths, and what was verified versus assumed. No secrets or personal data.

(No real harness verified yet.)

## M3 (2026-11-07): adapter framework, no real harness yet

- The `Adapter` interface (`src/adapters/types.ts`) matches PLAN section 6:
  `detect` / `install` / `uninstall` / `doctor`, user-level config only, idempotent,
  merges never overwrite.
- M3 ships only a **fake adapter** (`src/adapters/fake/`) to exercise the
  setup / uninstall / doctor framework. It writes one user-level JSON file
  (`~/.parley-fake/config.json`), merges a `parley` key, and on uninstall removes
  exactly what it added (deleting the file it created, or unmerging its key from a
  pre-existing file). No harness hook payloads, versions or config paths are verified
  yet — that work starts at M4 (Claude Code) or M3b (the work harness, once named).
- The adapter-facing CLI commands exist: `inbox drain|watch|register` and `hook edit`.
  Real harnesses will call these from their hooks/monitors (M4+).

## M4 (2026-11-07, kiro): Claude Code adapter

### Verified against official docs (code.claude.com/docs, fetched 2026-11-07)

Source pages: `/en/hooks` (hooks reference), `/en/plugins-reference` (plugin manifest),
`/en/plugins/components` (components). No `claude` binary was run; no real session captured.

- **User-level MCP registration lives in `~/.claude.json`**, not `~/.claude/settings.json`.
  User scope (`claude mcp add --scope user`) writes the server into the top-level `mcpServers`
  object of `~/.claude.json` (verified via the official MCP scope docs and multiple current
  third-party guides, 2026-11). Our adapter merges a `parley` entry into that object and never
  rewrites other keys. Shape: `{ "command": "npx", "args": ["parley-mcp", "serve"] }`.
- **Plugin layout** (plugins-reference): the manifest is `.claude-plugin/plugin.json` under the
  plugin root; every other component sits at the plugin root (not inside `.claude-plugin/`).
  `name` is the only required manifest key. Component defaults: hooks at `hooks/hooks.json`,
  monitors at `monitors/monitors.json` (under the `experimental.monitors` key). `${CLAUDE_PLUGIN_ROOT}`
  expands to the plugin root inside hook/monitor `command` strings.
- **Monitors** (components + manifest reference): `experimental.monitors` is an array of strict
  objects `{ name, command, description, when? }`. `command` runs as a persistent background
  process in the session's cwd for the whole session; **what the monitor prints reaches Claude as
  notifications**, which is exactly the idle-wake mechanism PLAN section 6 needs. `when` defaults
  to `"always"` (starts at session start). Monitors do NOT start in non-interactive `-p` mode.
  Minimum Claude Code version for monitors in some managed/telemetry-disabled environments is
  v2.1.310; otherwise available earlier (experimental). Monitor commands cannot use `${user_config.*}`.
- **Hook config** (hooks reference): plugin hooks go in `hooks/hooks.json` wrapped in a top-level
  `"hooks"` key mapping event name -> array of `{ matcher?, hooks: [{ type: "command", command, timeout? }] }`.
  `Edit|Write` is a valid `PostToolUse` matcher. Hook payloads arrive as JSON on **stdin**.
- **Hook event input fields** (verified field-by-field):
  - common: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`.
  - subagent identification: `agent_id` and `agent_type` are present when a hook fires inside a
    subagent (or an `--agent` session). We treat a payload carrying `agent_type` as a subagent
    event and ignore it (PLAN: "ignore hooks fired by subagents").
  - `SessionStart`: adds `source` (`startup`/`resume`/`clear`/`compact`/`fork`) and optional `model`.
  - `UserPromptSubmit`: adds `prompt` (the submitted text; pasted content expanded in place).
  - `PostToolUse`: adds `tool_name`, `tool_input` (file tools: absolute `file_path`), `tool_response`.
  - `Stop`: adds `stop_hook_active`, `last_assistant_message`.
  - `SessionEnd`: adds `reason` (`clear`/`resume`/`logout`/`prompt_input_exit`/`other`).
- **SessionStart runs before the session's MCP servers are available**, so launch-time work must be
  a `type: "command"` hook (not an `mcp_tool` hook). Our SessionStart hook is a command hook that
  registers the agent through the CLI, which opens the hub DB directly — no MCP round trip needed.
- `CLAUDE_CODE_SESSION_ID` as a child-process env var (claimed in PLAN 4.1 from Concord's notes) was
  **not** found in the current hooks docs. Instead every hook payload carries `session_id` on stdin,
  so our hook scripts read the native session id from the JSON payload, not the environment. The
  monitor process does not receive a hook payload; see assumptions below.

### Assumed / not yet verified (needs the human's live two-session test, M4 acceptance)

- **Agent id derivation.** We derive the Parley agent id as `claude@<basename(cwd)>` from the hook
  payload's `cwd`. Clash suffixing (`-2`, …) within a repo is handled by the store/identity layer
  when two folders share a repo root; not exercised without two real sessions.
- **Monitor agent id.** The monitor `command` runs in the session cwd but gets no `session_id`.
  We pass the agent id to the monitor by having it derive `claude@<basename(pwd)>` from its own
  working directory (same rule as the hooks). Assumed stable because Claude Code runs the monitor in
  the session's cwd. To be confirmed on a live run.
- **Read evidence.** We mark a message read when its message id appears in a `UserPromptSubmit`
  prompt, when the agent calls `inbox`, or when it replies (PLAN 4.3). Whether Claude naturally
  echoes a delivered message id into its next prompt is unverified; the monitor line includes the
  id so it can. Until confirmed, a delivered-but-unechoed message stays `delivered`, which is the
  intended fallback.
- **Monitor exit behaviour.** The monitor script exits when its parent harness process is gone and
  exits immediately in a folder with no Parley agents. The exact parent-pid semantics under Claude
  Code's monitor supervisor are assumed (parent = the process that spawned the monitor) and need a
  live check.
- **Fixtures are synthetic.** `src/adapters/claude-code/fixtures/*.json` are hand-written payloads
  marked `"_synthetic": true`, not captured from a real session. Replace with anonymised real
  captures during the human-assisted test, then keep the replay tests.
- Concord (`github.com/Get-Concord-AI/concord-mcp`, MIT) was used only as a conceptual reference for
  the monitor-wakes-idle mechanism. No code was copied.
