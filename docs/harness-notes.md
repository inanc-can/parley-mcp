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

### Idle wake: verified live in a cloud container (2026-11-07, Claude)

Method: npm `@openai/codex@0.154.0` in a throwaway CODEX_HOME, its native binary linked in as the
"standalone" install, the TUI driven in a pseudo-terminal, and a probe client on the control socket.
OpenAI is unreachable from that container, so turns start but the model never answers.

- **Daemon:** `codex app-server daemon start|stop|restart|version|bootstrap|enable-remote-control`.
  It requires the official-installer layout (`$CODEX_HOME/packages/standalone/current/codex`); an
  npm install fails with "managed standalone Codex install not found". `version` prints JSON with
  `status`, `socketPath`, `appServerVersion`.
- **Control socket:** `$CODEX_HOME/app-server-control/app-server-control.sock` (default
  `~/.codex/...`). It speaks **WebSocket** (HTTP upgrade, then one JSON-RPC message per text frame);
  raw JSON lines fail with "failed to upgrade control socket websocket connection".
  `codex app-server proxy` only pipes bytes, so a client still has to speak WebSocket. The path must
  stay under the Unix socket length limit (~104 bytes).
- **The TUI attaches to the daemon:** a plain `codex` started while the daemon runs uses it (its
  threads show in `thread/loaded/list` for other clients; `initialize` reports
  `userAgent: "codex-tui/0.154.0 ..."`). Started with `-c key=value` flags, the TUI ran its own
  in-process server instead. Started before the daemon, it also runs in-process.
- **Outside `turn/start` shows in the TUI:** a second client's `turn/start {threadId, input}` on the
  TUI's thread appeared in the TUI as a new user turn and it began working.
- **Thread id = hook session_id = rollout/session id** (`thread/read` → `sessionId` equals `id`; the
  hook payload's `session_id` equals the loaded thread id).
- **SessionStart fires at the first turn, not when the TUI opens.** An outside `turn/start` fires
  SessionStart (source `startup`) and then **UserPromptSubmit with `prompt` = our text**, so the
  message id in the text is read evidence. The MCP server starts when the session opens (before any
  turn), in the session's folder, with the `[mcp_servers.*.env]` vars (PARLEY_HARNESS) and HOME, but
  no thread id in its environment.
- **Thread status** (`thread/read` → `thread.status.type`): `idle`, `active` (a turn running),
  `notLoaded`. `thread.environments[0].cwd` is the session folder; `updatedAt` is epoch seconds.
- **`/quit` detaches:** "Disconnected from this task. Any running work continues. Reconnect: codex
  resume <id>". SessionEnd did not fire. An idle detached thread is unloaded: `thread/read` says
  `notLoaded` and `turn/start` errors "thread not found". A busy detached thread stays loaded.
- **`turn/start` on an `active` thread** returned the running turn's id (no error): it joins the
  running turn, like a steer. The wake never does this; it waits for `idle`.
- **Hook trust storage:** `/hooks` trust is saved in config.toml as
  `[hooks.state."<hooks.json path>:<event_snake_case>:<group>:<handler>"] trusted_hash = "sha256:…"`.
  `hooks/list {cwds}` returns each hook's `key`, `command`, `currentHash` and `trustStatus`
  (`trusted | untrusted | modified | managed`). doctor reads trust through `hooks/list`.
  Setup never writes trust entries: trusting is the human's decision.
- No client RPC queues input (`thread/queue/changed` is only a notification). `bypass_hook_trust`
  exists in the binary but did not take effect from config.toml.
- Concord (`src/relay/codex-client.ts`, `src/install/adapters/index.ts`) was read for the mechanism
  (daemon + control socket + `thread/resume`); no code copied. We never `thread/resume`: resuming a
  closed session would run a turn nobody sees.

### Assumed / needs the human's live two-session test (M5 acceptance)

- ~~Mapping a Codex native session to a Parley agent id~~: RESOLVED in the cloud test above (the
  thread id IS the hook session_id; a fresh session is found by folder).
- On macOS: the daemon backend (`pid` on Linux) and that the laptop's official-installer Codex
  behaves the same. The model's reply and the Stop-hook backstop (a turn must finish) need the
  laptop run.
- **Whether the human's Codex build enables `features.hooks`** (on by default) and trusts our hooks.
  doctor reports what it can see; the live test confirms a real idle round trip.
- **Fixtures are synthetic** (`src/adapters/codex/fixtures/*.json`, `_synthetic: true`) until the
  human captures anonymised real payloads, exactly as for Claude Code.
- Concord's `docs/codex.md` / `src/relay/codex-client.ts` were a conceptual reference only; no code
  copied. PLAN's Concord-derived note (`turn/start` / `turn/steer` with `expectedTurnId`) matched the
  generated schema's method shapes and is now verified against 0.154.0.

## M8 (2026-11-07, Claude, cloud session): Cursor adapter

### Verified against Cursor's official docs (fetched 2026-11-07)

Sources: cursor.com/docs/hooks.md, cursor.com/docs/mcp.md, cursor.com/docs/cli/changelog.md
(markdown versions of the docs pages; the cloud environment `parley-mcp` allows cursor.com).

- **MCP:** `~/.cursor/mcp.json` = `{ "mcpServers": { "<name>": { "command", "args", "env" } } }`
  (user level; `.cursor/mcp.json` per project). Cursor supports MCP **roots**. `${workspaceFolder}`
  resolves only in a project mcp.json, so a user-level server learns the folder through roots.
- **Hooks file:** `~/.cursor/hooks.json` = `{ "version": 1, "hooks": { "<event>": [ { "command": "…" } ] } }`.
  Per-script options: `command`, `type`, `timeout`, `loop_limit` (stop/subagentStop, default 5,
  `null` = no limit), `failClosed` (default false), `matcher`. User hooks run from `~/.cursor/`.
  Cursor reloads hooks.json on save. No trust step is documented for user hooks (project hooks run
  in trusted workspaces). All sources' hooks run; for `followup_message` the last response wins.
- **Common input:** `conversation_id`, `generation_id`, `model`, `hook_event_name`,
  `cursor_version`, `workspace_roots[]`, `user_email`, `transcript_path`. Env: `CURSOR_PROJECT_DIR`
  (always), `CURSOR_VERSION`, `CURSOR_TRANSCRIPT_PATH`, `CLAUDE_PROJECT_DIR`.
- **sessionStart:** input adds `session_id` (= conversation_id), `is_background_agent`,
  `composer_mode`; output `{ env, additional_context }`; fire-and-forget (cannot block). `env`
  reaches later hooks in the session.
- **beforeSubmitPrompt:** input `prompt`, `attachments`; output `{ continue, user_message }`.
- **afterFileEdit:** input `file_path` (absolute), `edits[]`.
- **stop:** input `status` (completed|aborted|error), `loop_count`; output `{ followup_message }`,
  auto-submitted as the next user message; counted per conversation against `loop_limit`.
- **sessionEnd:** input `session_id`, `reason` (completed|aborted|error|window_close|user_close),
  `duration_ms`, …; output ignored.
- **Background tasks wake the agent (CLI changelog):** "Background task follow-ups are back.
  Completion follow-ups for finished background tasks fire again in interactive and headless
  sessions." And for ACP: "when the agent starts a background shell that watches for output … the
  agent wakes up and responds". This is the mechanism PLAN's one-shot `inbox watch --once` relies on.

### Design choices

- Agent id `cursor@<basename(workspace_roots[0])>` (PLAN 4.1); the hook finds the agent by
  conversation id first. Hooks take the repo from `workspace_roots[0]` (or CURSOR_PROJECT_DIR),
  because user hooks run from `~/.cursor/`.
- `stop` installs with `loop_limit: null`, else Cursor would stop delivering after 5 follow-ups per
  chat. Parley's own guards bound it (20-message thread cap, stop-all, follow-up only when queued).
- Every `hook cursor-*` prints exactly one JSON reply even on errors (`{continue:true}` for
  beforeSubmitPrompt), so Parley can never block a prompt. Cloud background agents are ignored.
- The MCP server (PARLEY_HARNESS=cursor) renames itself after the first `file://` root once the
  client has initialized.

### Assumed / needs the human's live test

- That the desktop app (not only the CLI) resumes the agent when a Cursor-owned background shell
  task finishes, and that agents reliably follow the sessionStart instruction to start one watch.
  Concord documents the same behaviour for Cursor 3.13; unverified here.
- Whether beforeSubmitPrompt fires for a stop `followup_message` (read evidence for follow-ups).
  If not, those messages show `delivered` until the agent replies (PLAN 4.3 allows this).
- Two chats in one folder share `cursor@<folder>` (same known limit as the other adapters).
- `cursor-agent` could not be run in the cloud (running a downloaded binary was refused, and it
  needs a Cursor login). Fixtures are synthetic (`_synthetic: true`), built from the documented fields.

## M9 (2026-11-08, Claude, cloud session): Grok Build adapter

### Verified against xAI's official docs (docs.x.ai/build, fetched 2026-11-08)

Pages: features/hooks, features/skills-plugins-marketplaces, features/mcp-servers,
features/background-tasks, features/project-rules, settings/reference, cli/reference. The CLI is
npm `@xai-official/grok` (publisher `xai-security`, 1.0.77); its README points to these docs.

- **MCP:** `~/.grok/config.toml` `[mcp_servers.<name>]` with `command`, `args`, `env`
  (`${VAR}` expanded). Grok ALSO loads `~/.claude.json`, `.cursor/mcp.json` and `.mcp.json`,
  "merged below config.toml in priority", so our config.toml entry (PARLEY_HARNESS=grok) is the one
  a Grok session uses.
- **Hooks:** JSON files in `~/.grok/hooks/*.json` (personal, no trust needed) or project
  `.grok/hooks/` (needs `/hooks-trust`), Claude-style `{ "hooks": { "<Event>": [ { "matcher"?,
  "hooks": [ { "type": "command", "command", "timeout" } ] } ] } }`, default timeout 5 s. Events:
  SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse(Failure), PermissionDenied,
  Stop, StopFailure, Notification, SubagentStart/Stop, Pre/PostCompact.
- **Payload:** JSON on stdin with camelCase `hookEventName`, `sessionId`, `cwd`, `workspaceRoot`,
  and `toolName`/`toolInput` for tool events. Env: `GROK_HOOK_EVENT`, `GROK_HOOK_NAME`,
  `GROK_SESSION_ID`, `GROK_WORKSPACE_ROOT` (plugins add `GROK_PLUGIN_ROOT`/`GROK_PLUGIN_DATA`).
- **Output:** only PreToolUse decides (`{ "decision": "deny", "reason" }`, exit 2 denies);
  everything else is fail-open; "For passive events, stdout is ignored."
- **Grok reads other harnesses' files by default:** Claude Code marketplaces, plugins, skills,
  MCPs, agents, hooks and CLAUDE.md; Cursor hooks (camelCase events), mcp.json and rules. Switches:
  `[compat.claude]`/`[compat.cursor]` keys and `GROK_*_ENABLED` env vars.
- **Monitors:** "the agent can attach a monitor to a script: each line the script prints becomes a
  notification in the conversation." The agent starts it; nothing starts one automatically.
- **Skills:** `~/.grok/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, …).
- **Global rules:** `~/.grok/` is read as global rules (we do not write there).
- Plugins load from `~/.grok/plugins/`, but the plugin manifest format is not documented.

### Design (deviations from PLAN's sketch, all within its intent)

- **No plugin:** hooks go in our own `~/.grok/hooks/mcp-parley.json` and the instructions in a skill
  at `~/.grok/skills/mcp-parley/SKILL.md`, both documented user-level paths. A plugin's manifest is
  undocumented.
- **Agent id** `grok@<basename(cwd)>` (cwd, like the MCP server; workspaceRoot only as fallback,
  since it may be the repo root).
- **Telling the agent to start its monitor**, three ways: the skill; the MCP server's
  `instructions` (exact command with the agent id, sent only when PARLEY_HARNESS=grok); and PLAN's
  Stop reminder `{ "decision": "block", "reason" }`, once per session, only when no monitor is
  listed in `backgroundTasks` and our watch heartbeat (setting `watch:<agent>`) is older than 15 s.
- **Cross-harness guard:** every Claude, Codex and Cursor `hook` command does nothing when
  `GROK_HOOK_EVENT` is set (Cursor commands still print their empty reply), and the Claude plugin's
  monitor script exits when `GROK_SESSION_ID`/`GROK_HOOK_EVENT` is set. Without this a Grok session
  would also register as `claude@…`/`cursor@…`.

### Assumed / needs the human's live test

- **The Stop reminder may be ignored:** the docs say stdout of passive events (Stop included) is
  ignored. Concord documents the Stop `decision: "block"` behaviour and the Stop fields `reason`,
  `stopHookActive`, `subagentType`, `backgroundTasks`; none are in xAI's docs. If Grok ignores it,
  the skill and the MCP instructions remain the ways the agent learns to start its monitor.
- UserPromptSubmit's prompt field name (`prompt` assumed), Grok's edit tool names (a broad set plus
  `path` → `file_path` mapping), whether monitors receive GROK_* env, whether MCP `instructions`
  reach the model.
- Running the Grok binary in the cloud was refused (downloaded code), and turns need an xAI login,
  so fixtures are synthetic (`_synthetic: true`), built from the documented fields.
