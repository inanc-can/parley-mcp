# Harness notes

**Verified live, 2026-11-07 (Claude Code 2.1.303, then 2.1.319):** MCP servers are started in the
session's own folder (cwd) and receive `CLAUDE_CODE_SESSION_ID` (plus `CLAUDE_PROJECT_DIR`,
`CLAUDE_CODE_ENTRYPOINT`) in their environment. Plugin monitors receive NO `CLAUDE_*` variables; they run
in the session's starting folder. Plugin hooks fire in every session, including ones started before
setup. Names: the MCP key, plugin and marketplace are all `mcp-parley` (install target
`mcp-parley@mcp-parley`); older notes below that say `parley` predate the rename.

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

### M4 fix round (2026-11-07, kiro-M4-fix): plugin loading + identity corrected

Superseding details from the first M4 build, after the review and
`.workbench/tasks/M4/plugin-loading.md` (official docs, local CLI Claude Code 2.1.303):

- **A folder under `~/.claude/plugins/<name>` does NOT load.** That root only holds `cache/`,
  `marketplaces/`, `installed_plugins.json`, `known_marketplaces.json`. The documented install path
  is a local directory **marketplace** at a stable (non-temp) path, then `claude plugin
  validate` / `marketplace add --scope user` / `install <plugin>@<marketplace> --scope user`;
  `claude plugin list --json` verifies. We write the marketplace at
  `~/.parley-mcp/claude-marketplace/` with `.claude-plugin/marketplace.json`
  (`{name, owner, plugins:[{name, source:"./plugins/parley"}]}`) and the plugin under
  `plugins/parley/`. These `claude` commands run through an **injectable runner**
  (`src/adapters/claude-code/runner.ts`); tests use a fake and never call the real `claude`.
- **Uninstall** runs `claude plugin uninstall parley@parley --scope user` then
  `claude plugin marketplace remove parley --scope user`, then removes only the files install wrote.
- **`doctor`** runs `claude plugin list --json` and requires the plugin present AND enabled, plus the
  MCP server wired and the monitor files present, before reporting `canWakeIdle`. The exact
  `plugin list --json` shape is still unverified, so it is parsed defensively (accepts `name`/
  `plugin`, `enabled`/`disabled`/`status`, array or `{plugins:[…]}`); if the CLI can't be reached
  doctor reports "could not run `claude plugin list --json`" rather than a false positive.
- **`monitors.json` is a JSON array** of `{name, command, description}` (confirmed in
  plugins/components.md; unknown keys are an error) — not an object.
- **Identity env (the review's HIGH finding).** The MCP server entry in `~/.claude.json` now carries
  `env: { PARLEY_HARNESS: "claude" }`. Without it the per-session MCP server resolved `mcp@<folder>`
  while the hooks/monitor used `claude@<folder>`, splitting the agent across two inboxes. With it,
  `talk`/`inbox`/`agree` and the hooks resolve to the same `claude@<folder>` id.
- **Monitor race.** The monitor now runs `parley-mcp inbox register --agent "$AGENT"` (idempotent)
  and keeps polling, instead of exiting for good if SessionStart hasn't registered the agent yet.
- **Hook stdout.** Hook handlers write diagnostics to stderr only; a Claude Code hook's stdout
  becomes model context, so only genuine deliveries (the monitor's job) belong on stdout.
- **Stop-hook read evidence removed.** The first build marked messages read from
  `last_assistant_message`; that is the assistant's *output*, outside PLAN 4.3's definition of read
  evidence (model *input*, an `inbox` call, or a reply). It has been removed, so the Stop hook only
  drains at turn end. (Previously recorded as an assumption; now resolved by removal.)

### M4 fix round 2 (2026-11-07, kiro-M4-fix2): name, no-npx launcher, mid-turn delivery

- **Name is `mcp-parley`** (the human's choice). Data dir is now `~/.mcp-parley` (hub.db,
  `claude-marketplace/`, and the launcher `bin/mcp-parley`); `PARLEY_DB_PATH` still overrides the db
  path. The repo folder and the GitHub repo stay `parley-mcp`. The repo-level rules file
  `.parley/rules.md` (PLAN product decision) and the `PARLEY_*` env vars (stable override contract)
  were deliberately NOT renamed.
- **No `npx` in any installed config.** `npx mcp-parley …` (or `parley-mcp`) could download and run
  an unrelated registry package; the review confirmed `parley-mcp` on npm is a third party. Setup
  writes a launcher at `~/.mcp-parley/bin/mcp-parley` that runs THIS install's CLI by absolute path,
  and the MCP entry, every hook script, the monitor and the fake adapter's config all use that
  absolute launcher path. `doctor` additionally checks the MCP entry's `command` equals the
  launcher path, so a stale `npx` entry from an older install reports cannot-wake-idle.
  - **Build-first launcher (resolved 2026-11-07).** There is a `build` script
    (`tsc -p tsconfig.build.json` → `dist/`). `cliEntryPath()` prefers a compiled
    `dist/cli/bin.js` when it exists, so a launcher written by `setup` run from the built
    package uses **plain `node dist/cli/bin.js`** and needs no extra tooling. The live-test
    steps (`docs/PROGRESS.md`) run `pnpm build` first for exactly this reason. **Known
    limitation:** running `setup` directly from the `.ts` source (no `pnpm build` first)
    falls back to `node --import tsx <abs>/src/cli/bin.ts`, which needs `tsx` — not in PLAN's
    dependency list, so not added silently. Build first and this path is not used.
- **Mid-turn delivery.** `PostToolUse` and `Stop` hooks no longer drain. The documented
  `additionalContext` output for PostToolUse is not reliably surfaced to the model (public bug
  report, Jan 2026), so a drained-but-unshown message would be a silent loss. The hooks now only
  heartbeat (PostToolUse also records edits); the **monitor** is the single mid-turn delivery path
  (it prints the body, which wakes an idle/busy session at a safe point). Content rephrased for
  licensing compliance.
- **Monitor session id.** The monitor has no native Claude session id, so it uses `monitor-$$`
  (its own PID) and passes it via `inbox drain --session`, so deliveries record `delivered_session`
  and the session-scoped requeue (`requeueDeliveredToSession`) can act on monitor deliveries. ASSUMED
  stable for the life of the monitor process; confirm on the live run.
- **`claude plugin list --json` strictness.** `readPluginState` now requires explicit enabled
  evidence (`enabled: true`, `disabled: false`, or `status: "enabled"`) and matches the entry by
  `id`/`name`/`parley@parley`. The absence of an enabled/disabled/status field no longer counts as
  enabled. The exact JSON shape is still unverified (assumed: an array of entries, or
  `{ plugins: [...] }`, each `{ name|id|plugin, enabled|disabled|status }`); confirm on the live run.
- **PLAN section 6 deviation (recorded).** The monitor registers an agent in EVERY folder it runs in
  (it self-registers `claude@<basename(pwd)>` to survive the SessionStart race). PLAN describes
  registration as a SessionStart concern; the monitor doing it too means a folder with a running
  Claude session always has a registered agent even if SessionStart was missed. This is intentional
  (idempotent, never deletes) and recorded in `.workbench/state.json` assumptions.

## M5 (2026-11-07, kiro): Codex adapter

### Verified live against the installed Codex and generated schema

- **Codex version:** `codex-cli 0.154.0` (`codex --version`). The app-server protocol schema was
  generated with `codex app-server generate-json-schema --out <dir>` into a gitignored
  `dist/codex-schema/` (JSON Schema per message type, plus `v1/` and `v2/` dirs and
  `codex_app_server_protocol.v2.schemas.json`). No real `~/.codex` file was read or written by the
  build; the live Codex was only queried for `--help`, `--version` and the schema.
- **MCP server config path (VERIFIED by official docs + `codex mcp`):** `~/.codex/config.toml`,
  table `[mcp_servers.<name>]`. We manage `[mcp_servers.mcp-parley]`. Codex, the IDE extension and
  the desktop app all read this one file. `codex mcp add|list|get|remove` exist, but we **merge the
  TOML ourselves with `smol-toml`** (PLAN-approved dep) so we can preserve comments and every other
  table, keep the merge idempotent, and restore byte-for-byte on uninstall — `codex mcp add` would
  rewrite the file in Codex's own style and is harder to reverse exactly.
  - Entry shape: `command` = this install's absolute launcher path (never `npx`),
    `args = ["serve"]`, and `[mcp_servers.mcp-parley.env] PARLEY_HARNESS = "codex"` so the per-session
    MCP server resolves the same `codex@<folder>` id its hooks use (same identity-split fix as M4).
- **Hooks (VERIFIED, learn.chatgpt.com/docs/hooks):** config is `~/.codex/hooks.json` (user level) OR
  inline `[hooks]` in config.toml; a layer with both is merged and warned. We write **`~/.codex/hooks.json`**
  (separate file, cleaner to add/remove than editing config.toml twice). Shape:
  ```json
  { "description": "...", "hooks": {
      "SessionStart": [ { "matcher": "startup|resume|clear|compact|fork",
                          "hooks": [ { "type": "command", "command": "<launcher> hook codex-session-start", "timeout": 10 } ] } ],
      "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "<launcher> hook codex-user-prompt" } ] } ],
      "PostToolUse": [ { "matcher": "Edit|Write|apply_patch", "hooks": [ { "type": "command", "command": "<launcher> hook codex-post-tool" } ] } ],
      "Stop": [ { "hooks": [ { "type": "command", "command": "<launcher> hook codex-stop" } ] } ],
      "SessionEnd": [ { "hooks": [ { "type": "command", "command": "<launcher> hook codex-session-end", "timeout": 3 } ] } ]
  } }
  ```
  Event names are **PascalCase** (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`,
  `SessionEnd`). `matcher` is a regex; `UserPromptSubmit` and `Stop` **ignore** any matcher.
  `PostToolUse` matches the tool name — for file edits use `Edit|Write` and `apply_patch` (apply_patch
  also accepts `Edit`/`Write` matcher values). `SessionEnd`/`Interrupt` default timeout is 1 s, max 3 s.
- **Hook command stdin fields (VERIFIED):** `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
  `model`, `permission_mode` (common); `SessionStart` adds `source` (startup/resume/clear/compact/fork);
  `UserPromptSubmit` adds `prompt` + `turn_id`; `PostToolUse` adds `tool_name`/`tool_input`
  (`tool_input.file_path` for file tools) + `turn_id`; `SessionEnd` adds `reason` (only `other`).
  These field names MATCH Claude Code's, so the M5 Zod schemas mirror the M4 ones (session_id, cwd,
  prompt, tool_input, source, reason) with Codex's extras allowed via `.looseObject`.
- **Subagents:** Codex fires **separate** `SubagentStart`/`SubagentStop` events (not the main
  SessionStart/Stop), and subagent hooks report the *parent* `session_id`. `agent_id`/`agent_type`
  appear on SubagentStop. We register no subagent hooks, so the main hooks never see a subagent; the
  `isSubagentPayload` guard (agent_id/agent_type present) stays as defence in depth.
- **Hook TRUST (VERIFIED):** non-managed command hooks must be reviewed and **trusted** before they
  run; Codex records trust against the hook's current hash, so any later edit re-prompts. The user
  trusts via the interactive `/hooks` browser in the CLI (there is NO non-interactive `codex hooks`
  subcommand — `codex` top-level has `mcp`, `plugin`, `app-server`, `doctor`, …, not `hooks`). So:
  - **setup must tell the human to run `/hooks` and trust the new mcp-parley hooks** (and restart
    sessions). We print this instruction.
  - **doctor** cannot query per-hook trust without a running app-server connection (`hooks/list`
    returns `trustStatus: managed|untrusted|trusted|modified`). Offline, doctor reports
    `hooksTrusted: null`-equivalent as "unknown — trust them with /hooks" and bases `canWakeIdle`
    on the config files being present and the app-server being reachable. It never claims trusted.
- **Idle wake — app-server (VERIFIED method shapes, gated to this protocol):** hooks DON'T fire while
  a session is idle, so idle wake uses `codex app-server` (stdio JSON-RPC). Handshake: `initialize`
  with `clientInfo` (→ `InitializeResponse { codexHome, platformFamily, platformOs, userAgent }`).
  Methods (v2): `turn/start` (`TurnStartParams { threadId, input: UserInput[], … }`) starts a turn on
  an idle thread; `turn/steer` (`TurnSteerParams { threadId, expectedTurnId, input }`) injects into a
  **busy** turn — `expectedTurnId` is a required precondition and the call fails with
  `activeTurnNotSteerable` (for `/review` or `/compact` turns) or a turn-id mismatch. `input` is a
  `UserInput[]`; the text variant is `{ type: "text", text }`. PLAN says prefer queuing until the
  turn ends then `turn/start`; we only `turn/steer` at a safe point. **Fail closed:** if the
  app-server is unreachable or its protocol version doesn't match what we verified (0.154.0 / v2),
  we DON'T attempt delivery — `outlook` says "queued until the next turn" and we fall back to the
  hooks + the MCP server's own inbox drain.

### Assumed / needs the human's live two-session test (M5 acceptance)

- **Mapping a Codex native session to a Parley agent id.** We derive `codex@<basename(cwd)>` from the
  hook payload's `cwd` (same rule as Claude). The app-server's `threadId`/`turnId` (for idle wake)
  are NOT the same as the hook `session_id`; wiring the live app-server thread id to the agent is the
  part most likely to need adjustment on the human's real run — until confirmed, idle wake is gated
  and falls back to "queued until next turn" rather than mis-delivering.
- **Whether the human's Codex build enables `features.hooks`** (on by default) and trusts our hooks.
  doctor reports what it can see; the live test confirms a real idle round trip.
- **Fixtures are synthetic** (`src/adapters/codex/fixtures/*.json`, `_synthetic: true`) until the
  human captures anonymised real payloads, exactly as for Claude Code.
- Concord's `docs/codex.md` / `src/relay/codex-client.ts` were a conceptual reference only; no code
  copied. PLAN's Concord-derived note (`turn/start` / `turn/steer` with `expectedTurnId`) matched the
  generated schema's method shapes and is now verified against 0.154.0.
