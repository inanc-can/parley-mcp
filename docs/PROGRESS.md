# Progress

## M7: notifications, rules file, loop guard end to end (Claude, cloud session, 2026-11-07)

**Built:**
- `src/notify/os-notify.ts` (PLAN section 9): macOS `osascript`, Linux `notify-send` when on PATH,
  Windows nothing. Text is passed as command arguments, never spliced into the script (no
  AppleScript or shell injection). Content never beyond a 60-character preview. Failures are
  swallowed so a notification can never break a tool call or hook.
- Notifications fire for: a thread pausing at its cap (`talk`), an accepted agreement (`agree`),
  and an edit conflict (`hook edit`, also through Claude/Codex PostToolUse). `serve` and the CLI
  hooks inject the real notifier.
- PLAN 4.5 conflict messages (were missing): on a conflict both agents get a `system` message in a
  thread titled `conflict: <path>`, reused while open.
- Every tool result now also carries its structured value as JSON text (MCP spec guidance). Before,
  the text block held only the summary, so a client that shows the model only text would have marked
  inbox messages read, and sent the rules text, without the model seeing either.

**Checks:** `pnpm check` passes (46 files / 255 tests). The M7 check is
`test/mcp/m7-end-to-end.test.ts`, through the real MCP server: a scripted 20-message conversation
pauses the thread, notifies once and refuses the 21st with `thread_paused`; a fake `ghp_` token is
blocked as `secret_blocked` and never echoed; with `.parley/rules.md` present, talk and inbox carry
the reminder and inbox returns the text once per session. Notifier tests cover the argument-only
osascript call, Linux with/without notify-send, Windows, failures, and the 60-character cap.

**Laptop check (optional):** create `.parley/rules.md` in the test repo, then have two agents argue
until the thread pauses: a macOS notification "Parley: thread paused" should appear.

## M6: viewer (Claude, cloud session, 2026-11-07)

Started at the human's request while M5's laptop test is still open (see the M5 section below).

**Built (PLAN section 8):**
- `src/viewer/server.ts`: `node:http` on 127.0.0.1 only, random free port (or `--port`). A
  48-hex token is required on the page and every API call (`?token=` or `x-parley-token`); the
  page's own `app.js`/`styles.css` are served without it (they hold no data, and the browser
  fetches them without the query). Host header must be 127.0.0.1/localhost (DNS rebinding), strict
  CSP, `Referrer-Policy: no-referrer` (the token is in the URL), 64 KB body limit.
- SSE `/api/events`: no daemon exists, so one poller compares a change signature (messages,
  receipts, events, agreements, thread status/cap, stop-all, alive/idle flips) every second and
  pushes `change`; the page refetches. Heartbeats alone do not trigger events.
- `src/viewer/api-read.ts` / `api-write.ts`: state, thread view, post as `you` (one row per thread
  participant, idempotent, secret scan, not limited by cap/stop-all, refused in closed threads,
  wakes Codex recipients), pause, resume (+20 from where the thread is), close, veto (accepted
  only; both agents get a `system` message), stop-all. New store queries: `vetoAgreement`,
  `listAgreementsByThread`.
- `src/viewer/static/`: plain TypeScript + DOM (no innerHTML for agent text), zod/mini response
  parsing, light/dark, single column under 760 px. Bundled by `scripts/build-viewer.mjs` (esbuild,
  now a pinned dev dependency) into `dist/viewer/static` (25 KB). `pnpm build` runs it.
- `mcp-parley viewer [--port n] [--no-open]` prints the tokened URL and opens the browser
  (macOS `open`, Linux `xdg-open`); export buttons reuse `mcp-parley export`.

**Checks:** `pnpm check` passes (44 files / 243 tests). The M6 automated check
(`test/viewer/server.test.ts`) drives the real HTTP API: token and Host rejection, post as you,
pause/resume, stop-all blocking talk, veto, an SSE `change` after another writer's message, export.
Browser run (Playwright, compiled CLI, seeded db): post as you, a reply written by another process
appeared without reload, veto worked, no console errors; 375 px dark layout has no horizontal
scroll. That run caught a bug the unit tests missed (assets 403 without the token), now fixed and
tested.

### (H) Laptop check
With the M5 setup running: `node dist/cli/bin.js viewer` in the test repo, then have Claude and
Codex talk (`say hi to codex@api`). The thread should update live without reloading; try Pause,
Post as you, and Stop all.

## M5: review + idle wake (Claude, cloud session, 2026-11-07)

**Review of the kiro-M5 build** (by hand; the workbench tool is not in the cloud). The config.toml
and hooks.json merge, uninstall and foreign-entry guard are sound. Findings, all fixed here:

1. **Idle wake was not wired** (M5's core acceptance). Built and verified live (below).
2. **A clean checkout failed `pnpm check`**: `@types/better-sqlite3` (PLAN-allowed) was missing from
   package.json; the laptop passed only because of old node_modules. Added.
3. **A Codex tool call erased the recorded thread id**: `heartbeatCaller` wrote the MCP server's
   null session over the id the SessionStart hook stored. A null session now only touches liveness.
4. **doctor's "app-server reachable" only ran `codex --version`**, which says nothing about the
   daemon the wake needs. doctor now connects to the daemon and reads hook trust from it.
5. **planWake steered busy threads**; PLAN prefers queuing. A busy thread is now waited on.
6. **SessionStart fires at a session's first turn, not when it opens** (found live), so a fresh
   idle session had no thread id. The wake now finds the thread through the daemon by folder.

**How the wake works (verified live against codex 0.154.0; detail in docs/harness-notes.md):**
`talk` to a `codex@…` agent starts a detached `mcp-parley codex-wake --agent <id>`. It connects to
the daemon's control socket (`~/.codex/app-server-control/app-server-control.sock`, WebSocket),
checks the version (0.154.x only), finds the agent's live thread and `turn/start`s it with the
message line (id + reply hint). The open TUI shows the turn; its UserPromptSubmit hook sees the id
and marks the message read. Busy: polls until idle (60 s), and the Codex Stop hook starts another
wake at each turn end. No daemon, another version, or a closed session: the message stays queued.

**Live cloud test (isolated HOME, npm Codex 0.154.0 binary used as the "standalone" install):**
real `setup --harness codex` (user comment kept), `doctor` → "hooks NOT trusted", trust recorded →
"can wake idle, hooks trusted"; Codex TUI opened in `repo/api` and left untouched; a real MCP
`talk` from `claude@web` → outlook "waking"; the TUI showed the message and started a turn within
~6 s; the message went to `read`, `delivered_session` = the thread id. Not testable in the cloud:
the Codex model replying (OpenAI is blocked there).

**Checks:** `pnpm check` passes (41 files / 225 tests).

### (H) Laptop test: Claude ↔ Codex (replaces the kiro-M5 steps below)

Needs Codex from the **official installer** (the daemon refuses an npm install), Claude Code, and
this repo built.

1. `codex --version` → 0.154.x. If Codex came from npm/brew, install it with the official installer
   (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`) or `codex app-server daemon start`
   fails with "managed standalone Codex install not found".
2. `pnpm build && node dist/cli/bin.js setup` (both harnesses).
3. `codex app-server daemon start`.
4. Open Codex, run `/hooks`, trust the five mcp-parley hooks, quit Codex.
5. `node dist/cli/bin.js doctor` → codex: "can wake idle, hooks trusted".
6. In the test repo: Codex in `api` (start it AFTER the daemon, without `-c` flags, which make it
   run its own private server), Claude Code in `web`. Leave Codex idle.
7. In Claude: `say hi to codex@api`. Expect Codex to start a turn within ~5 s and answer with the
   talk tool, which wakes Claude through the M4 monitor. `node dist/cli/bin.js log --thread <id>`
   shows read/replied.
8. Busy case: give Codex a long task, send it a message meanwhile; it should answer after the task.
9. Optional: capture real hook payloads into `src/adapters/codex/fixtures/` (replace the synthetic
   ones) and run `uninstall` to confirm config.toml is restored byte for byte.

Open product question for the human: after `/quit`, a busy Codex thread keeps running in the
daemon ("Any running work continues"). A wake that lands on such a thread runs a turn with no TUI
attached (visible in `codex agents`, reattach with `codex resume <id>`). Idle closed sessions are
unloaded and never woken.

## M5 — Codex adapter (plan, session kiro-M5, 2026-11-07)

**Goal (PLAN section 6 "Codex" + M5):** build `src/adapters/codex` — user-level MCP registration in
`~/.codex/config.toml [mcp_servers.mcp-parley]` (merged with `smol-toml`, keeping comments + other
tables), Codex lifecycle hooks in `~/.codex/hooks.json`, and an app-server idle-wake client
(`turn/start` / `turn/steer`) gated to the verified protocol and fail-closed. Idempotent install,
byte-for-byte uninstall, a `doctor` that reports untrusted hooks. Reuse the M4 patterns the live
test proved (absolute launcher, MCP key `mcp-parley`, never touch foreign entries, identity bound to
the harness session, monitor/drain lines carrying the message id + reply hint, heartbeat per poll).

**Verified facts** are in `docs/harness-notes.md` (M5 section): codex 0.154.0, config/hook paths,
hook payload fields, hook trust via `/hooks`, and the app-server method shapes from the generated
schema. Tests use a temp HOME + fake runners/sockets; the real `~/.codex` is never touched and no
codex session is started.

**Plan (work items):**
1. Add `smol-toml` (PLAN-allowed) pinned; config.toml merge helper (round-trips comments + tables).
2. `src/adapters/codex/config-files.ts` — the MCP entry, `hooks.json`, the hook-command names.
3. `src/adapters/codex/install.ts` — install/uninstall/doctor (merge-not-overwrite, exact undo,
   foreign-entry guard, launcher reuse).
4. `src/adapters/codex/app-server.ts` — `initialize` handshake + `turn/start`/`turn/steer` request
   builders, gated to the verified version, fail-closed.
5. `src/cli/commands/hook-events.ts` (or a Codex sibling) — the five Codex hook handlers reusing the
   M4 logic; wire `hook codex-*` subcommands.
6. `src/adapters/codex/index.ts` + register in `src/adapters/index.ts`.
7. Synthetic fixtures + replay tests; install/uninstall/doctor/app-server tests.
8. Exact (H) live-test steps for Claude <-> Codex in this file; update state.json; `wb handoff`.

**Status:** built. `pnpm check` passes (36 files / 193 tests). `wb verify` pending.

### What was built

- **`src/adapters/codex/config-files.ts`** — the managed `[mcp_servers.mcp-parley]` TOML block
  (fenced with begin/end markers, `command` = the absolute launcher, `args=["serve"]`, nested
  `env.PARLEY_HARNESS="codex"`) and the `hooks.json` object (SessionStart/UserPromptSubmit/
  PostToolUse/Stop/SessionEnd, PascalCase, handlers invoking `<launcher> hook codex-*`).
- **`src/adapters/codex/toml-merge.ts`** — surgical, comment-preserving config.toml merge:
  `smol-toml.parse` only INSPECTS (detect our/foreign entry); install APPENDS the fenced block;
  uninstall excises exactly it so the rest is byte-for-byte. Foreign-entry guard (`isOurEntry` =
  command ends with `/.mcp-parley/bin/mcp-parley`).
- **`src/adapters/codex/hooks-merge.ts`** — JSON merge of hooks.json: keeps the user's groups, adds
  ours (idempotent, ours replaced not duplicated); uninstall removes only our groups and deletes the
  file only when nothing of theirs remains.
- **`src/adapters/codex/app-server.ts`** — `initialize`/`turn/start`/`turn/steer` request builders
  against the generated v2 schema, `planWake` (idle→turn/start, busy→turn/steer with expectedTurnId,
  else fail-closed fallback), and a version gate (`gateOpenForVersion`) + offline reachability probe.
- **`src/adapters/codex/install.ts`** — install/uninstall/doctor; doctor reports each check and
  `hooksTrusted: null` (never falsely trusted; the human trusts via `/hooks`). setup prints the
  trust instruction.
- **Hooks reuse:** `src/cli/commands/hook-events.ts` was generalized (injectable `agentIdForCwd` +
  `editTools`); Codex wires `codex@<folder>` + `apply_patch`. `src/cli/hook-commands.ts` (new) holds
  the Claude + Codex `hook` subcommand registration (split out of cli/index.ts for the 400-line cap).
- **Fixtures** `src/adapters/codex/fixtures/*.json` (synthetic, `_synthetic:true`) + the two vendored
  app-server schema files under `fixtures/schema/`; replay + app-server + install tests.
- **Dependency:** `smol-toml@1.4.2` (PLAN-allowed, exact-pinned).

### (H) Human live two-session test — exact steps (Claude ↔ Codex) — SUPERSEDED by the steps in the section above

M5's acceptance is marked **(H)**: it needs a real Claude Code session and a real Codex session in
one repo, with Codex idle. The build cannot run `codex` itself; automated tests use a temp HOME and
fake sockets. Use `Project Parley/parley-test` as the shared repo (two folders, e.g. `api`, `web`).

1. **Build and run setup from this repo.**
   ```sh
   cd "/Users/inanccan/Desktop/Project Parley/parley-mcp"
   pnpm build
   node dist/cli/bin.js doctor                 # shows claude-code + codex rows
   node dist/cli/bin.js setup --harness codex
   ```
   setup writes the launcher `~/.mcp-parley/bin/mcp-parley`, merges
   `[mcp_servers.mcp-parley]` into `~/.codex/config.toml` (keeping your comments and other tables),
   writes/merges `~/.codex/hooks.json`, and prints the **trust the hooks via /hooks** instruction.
   It never runs `npx`.
2. **Trust the hooks.** Open Codex and run `/hooks`; review and TRUST the mcp-parley SessionStart /
   UserPromptSubmit / PostToolUse / Stop / SessionEnd hooks (Codex records trust against each hook's
   hash). Then `node dist/cli/bin.js doctor` should show codex: wired + hooks present (it reports
   hooks-trust as unknown — Codex exposes trust only in the interactive `/hooks`).
3. **Confirm the MCP server loads:** `codex mcp list` (or `codex mcp get mcp-parley`) shows
   `mcp-parley` → the launcher with `args=["serve"]` and `PARLEY_HARNESS=codex`. Restart any open
   Codex session so the server + hooks load.
4. **Open two sessions in one repo, different folders** — Claude Code in `<repo>/web` (idle target or
   sender) and Codex in `<repo>/api`. Each registers as `claude@web` / `codex@api` on SessionStart.
   `node dist/cli/bin.js who` (run in the repo) lists both alive.
5. **Idle Codex round trip.** Leave the Codex session idle. In the Claude session type
   `say hi to codex@api`. Expect the idle Codex session to answer **within 5 s with no typing**: the
   MCP server's `talk` queues the message; the app-server idle-wake (`turn/start`) delivers it. If
   the app-server is unavailable, `outlook` says "queued until the next turn" and the message is
   delivered on Codex's next turn (the fail-closed fallback) — note which path fired.
6. **Reverse leg:** from Codex, reply (the monitor/inbox line carries the message id + a reply hint);
   confirm receipts move via `node dist/cli/bin.js log --thread <id>`: delivered ✓✓, then read / replied.
7. **doctor reports untrusted hooks.** Before step 2 (or after editing a hook so its hash changes),
   `doctor` + Codex `/hooks` should show the hooks as untrusted/needing review; after trusting, they
   run. Record what `/hooks` showed.
8. **Capture fixtures:** log the real Codex hook payloads (SessionStart, UserPromptSubmit with a
   message id, PostToolUse apply_patch, SessionEnd), anonymise paths/ids, replace the synthetic
   `src/adapters/codex/fixtures/*.json` (drop `_synthetic` or set it false), and keep the replay
   tests green. Also capture one real `turn/start`/`turn/steer` exchange to confirm the builders.
9. **Uninstall check:** `node dist/cli/bin.js uninstall`, then confirm `~/.codex/config.toml` is
   restored byte-for-byte (your comments + other tables + any foreign `mcp-parley` entry intact),
   `~/.codex/hooks.json` keeps any non-mcp-parley hooks (or is gone if it held only ours), and the
   launcher is removed.

If step 5 fails within 5 s, check (assumptions in `docs/harness-notes.md` M5): whether the
app-server exposes the recipient session's live `threadId`/active `turnId` to us (the gated, deferred
wiring), whether `features.hooks` is on and our hooks are trusted, and the `codex@<folder>` id
derivation.

---

## M4: live test, 2026-11-07 (Claude, with the human)

**First run:** setup installed the plugin; the idle web session woke ~1 s after api sent "Hi". Bugs found
and fixed in a7a14c9 and the next commit: the MCP server named itself after the repo root
(claude@parley-test); a session that cd'd took over another folder's agent; active sessions showed as idle;
the woken agent didn't know to reply; setup overwrote another tool's `parley` MCP server (key renamed to
`mcp-parley`, foreign entries are never touched); the monitor's register wiped the session link.
**Re-run:** api (headless) -> web (idle, interactive): sent 20:37:43, delivered 20:37:47, read 20:37:49,
and web answered on its own. Its replies with reply_to failed (reply_to_unknown) because talk opened a new
thread; fixed: a reply_to with no thread_id joins the original's thread. Next: re-test the reply leg.


## M4 — fix round 2 (session kiro-M4-fix2, 2026-11-07)

Applied review round 2 (`.workbench/tasks/M4/review-round-2.json`, soft_fail 6/10). The human chose
the name **mcp-parley**.

**Fixes**
0. **Rename to `mcp-parley`.** `package.json` name, the CLI program name/help, the data dir
   (`~/.parley-mcp` → `~/.mcp-parley`, `PARLEY_DB_PATH` override kept), the plugin/marketplace
   launcher names, docs and tests. The repo folder and the GitHub repo stay `parley-mcp` (renaming
   the GitHub repo is the human's outward action). The repo-level rules path `.parley/rules.md` and
   the `PARLEY_*` env vars are product/contract names and were deliberately NOT renamed.
1. **No `npx`, ever (HIGH).** The npm name `parley-mcp` is an unrelated third-party package, so every
   installed `npx …` was a code-execution risk. Setup now writes a launcher at
   `~/.mcp-parley/bin/mcp-parley` (runs THIS repo's CLI by absolute path) and points the MCP entry,
   every hook script, the monitor and the fake config at that absolute launcher. New test asserts no
   generated file contains `npx`; `doctor` fails when the configured command does not point at this
   install (`src/adapters/cli-path.ts`).
2. **Mid-turn messages not swallowed (HIGH).** `PostToolUse` and `Stop` no longer drain. Draining
   marks a message `delivered` with no reliable way to show its body (`additionalContext` for
   PostToolUse is documented but not reliably implemented — see harness-notes). The hooks now only
   heartbeat (and PostToolUse records edits); delivery is left to the monitor, which surfaces the
   body and wakes the session. Test: a message arriving mid-turn stays `sent` through PostToolUse +
   Stop and is then surfaced (and marked `delivered`) by `inbox drain`.
3. **Report `claude` failures.** `InstallReport.notes` carries any non-zero `claude plugin …` step;
   `setup`/`uninstall` print them. Tests use a fake runner returning exit 1 for `install` /
   `uninstall`.
4. **Monitor passes its session.** `monitor.sh` passes `--session monitor-$$` to `inbox drain`, so
   monitor deliveries record `delivered_session` and the session-scoped requeue works. Test: a
   monitor-delivered message requeues when its monitor session ends.
5. **Strictness + deviation.** `readPluginState` now requires explicit enabled evidence (no
   permissive "assume enabled" default) and matches by id/name/ref. The monitor test is strengthened
   so a mutation that exits the loop on the first failed drain fails (the only `exit` is the
   parent-pid guard; the drain line is unconditional; no `set -e`). The "monitor registers an agent
   in every folder" PLAN-6 deviation is recorded in `.workbench/state.json`.
6. **Docs.** Live-test step 1 now gives the exact command to run setup from this repo; step 7 no
   longer depends on the unbuilt viewer (uses `mcp-parley log` / `mcp-parley inbox`).

**Result:** `pnpm check` (eslint strict + tsc --noEmit + vitest) — **passed, 30 files / 154 tests**.

### (H) Human live two-session test — exact steps (fix round 2)

This is M4's acceptance check (PLAN marks it **(H)**). The build cannot run `claude` itself and the
automated tests use a temporary HOME + a fake runner; a real run needs two Claude Code sessions.

1. **Build and run setup from this repo (no published package yet, M12).** No `tsx` is needed: the
   build compiles the CLI with TypeScript (already a dependency) into `dist/`, and the launcher runs
   the compiled `dist/cli/bin.js` with plain Node.
   ```sh
   cd "/Users/inanccan/Desktop/Project Parley/parley-mcp"
   pnpm build                                      # compiles src/ -> dist/
   node dist/cli/bin.js doctor                     # confirm the CLI runs
   node dist/cli/bin.js setup --harness claude-code
   ```
   `setup` writes the launcher `~/.mcp-parley/bin/mcp-parley` (plain `node .../dist/cli/bin.js`) and
   points every config at it, never `npx`. Re-run `pnpm build` after pulling new code.
2. **Check what setup changed.** It prints `~/.claude.json` (merged `mcpServers.mcp-parley`, command =
   the absolute launcher path, `env.PARLEY_HARNESS=claude`), the marketplace tree under
   `~/.mcp-parley/claude-marketplace/`, and any `claude plugin …` errors as `! …` lines.
3. **Verify the plugin loaded:** `claude plugin list --json` shows `mcp-parley@mcp-parley` enabled; then
   `node dist/cli/bin.js doctor` should say **can wake idle** (it checks the plugin list, the
   monitor files, and that the MCP command points at this install). If not, re-run
   `claude plugin install mcp-parley@mcp-parley --scope user` and restart Claude.
4. **Restart any open session** so the new MCP server and plugin load. Monitors are experimental —
   ensure your Claude Code is recent enough (`docs/harness-notes.md` records the version floor).
5. **Open two sessions in one repo, different folders** (A in `<repo>/api`, B in `<repo>/web`). Each
   registers as `claude@api` / `claude@web` on SessionStart. `mcp-parley who` (run from the repo via
   `node dist/cli/bin.js who`) should list both as alive.
6. **Leave session B idle.** In session A type `say hi to claude@web`. Expect B's monitor to surface
   the message and the idle agent to answer **within 5 s with no typing in B**.
7. **Confirm receipts without the viewer (M6 not built).** Run
   `node dist/cli/bin.js log --thread <id>` (the thread id is printed by `log`), or
   call the `inbox` MCP tool with `include_sent: true` from session A, and confirm the message shows
   `delivered ✓✓` and, after B's reply or a prompt echoing the id, `read` / `replied`.
8. **Check requeue when a reader closes unread.** Send A→B a new message and, before B reads or
   replies, **close session B**. Then re-open session B in the same folder. The message must be back
   to `sent` and surface again: SessionStart (`source=startup`) requeues this agent's delivered-but-
   unread messages, and SessionEnd requeues any monitor-surfaced deliveries, because the monitor
   records `delivered_session=monitor-<pid>` which no Claude SessionEnd can match (PLAN 4.3).
9. **Capture fixtures:** save the real hook payloads Claude Code sends, anonymise paths/ids, replace
   the synthetic `src/adapters/claude-code/fixtures/*.json`, and keep the replay tests green.
10. **Uninstall check:** `node dist/cli/bin.js uninstall`, then confirm
   `claude plugin list --json` no longer shows `mcp-parley@mcp-parley`, `~/.claude.json` keeps your other keys, and
   both `~/.mcp-parley/claude-marketplace/` and `~/.mcp-parley/bin/mcp-parley` are gone.

If step 6 fails within 5 s, check (assumptions in `docs/harness-notes.md`): the monitor's agent-id
derivation (`claude@$(basename "$PWD")`), whether the monitor's stdout reaches Claude as a
notification on your version, the parent-pid exit guard, and whether the plugin is enabled.

---

## M4 — fix round (session kiro-M4-fix, 2026-11-07)

Applied the independent review (`.workbench/tasks/M4/review.json`) and the confirmed plugin-loading
findings (`.workbench/tasks/M4/plugin-loading.md`) before the human's live test.

**Fixes**
1. **Identity split (HIGH).** The MCP server entry now carries `env: { PARLEY_HARNESS: "claude" }`,
   so the per-session MCP server resolves `claude@<folder>` — the same agent id the hooks and
   monitor use — and `talk`/`inbox`/`agree` share the hooks' inbox. Test proves the installed entry
   carries the env and that `resolveAgentId(undefined, cwd)` with `PARLEY_HARNESS=claude` equals the
   hooks' `claudeAgentId(cwd)`.
2. **Plugin loading.** A folder under `~/.claude/plugins` does not load. Install now writes a local
   directory marketplace at `~/.parley-mcp/claude-marketplace/` (`.claude-plugin/marketplace.json` +
   `plugins/parley/`) and runs — through an **injectable command runner** — `claude plugin validate`,
   `claude plugin marketplace add <path> --scope user`, `claude plugin install parley@parley --scope
   user`. Uninstall runs `claude plugin uninstall` + `marketplace remove`, then removes only the
   files install created. `doctor` runs `claude plugin list --json` (parsed defensively) and checks
   the monitor files before reporting `canWakeIdle`; a test with `monitor.sh` missing asserts
   `canWakeIdle === false`. All adapter tests use a fake runner and never call the real `claude`.
   `monitors.json` is a JSON array of `{name, command, description}`.
3. **PostToolUse once.** Registered a single `PostToolUse` entry (was two: matched + catch-all),
   so edits/drain run once per tool use.
4. **SessionEnd requeue scope.** New `requeueDeliveredToSession` requeues only messages delivered to
   the ending `session_id`, not every delivered message across the agent's other live sessions.
   Two-session test added.
5. **Monitor race + hook stdout.** `monitor.sh` registers its agent itself (idempotent) and keeps
   polling instead of exiting on the SessionStart race. All hook diagnostics go to a stderr `status`
   channel so only genuine deliveries reach Claude Code's hook stdout (which becomes model context).
6. **Fake adapter.** Removed from the production `ADAPTERS` list (kept importable for tests);
   `setup`/`uninstall`/`doctor` take an injectable adapters list.
7. **Stop-hook read evidence.** Dropped `last_assistant_message` as read evidence — it went beyond
   PLAN 4.3 (read = model input, an `inbox` call, or a reply; the assistant's own output is not).

**Result:** `pnpm check` (eslint strict + tsc --noEmit + vitest) — **passed, 30 files / 147 tests**.
`wb verify` PASS.

### (H) Human live two-session test — exact steps (updated this round)

This is M4's acceptance check (PLAN marks it **(H)**). The build cannot run `claude` itself and the
automated tests use a temporary HOME + a fake runner; a real run needs two Claude Code sessions.

1. **Make `parley-mcp` runnable.** No published package yet (M12), so run the CLI via a local shim so
   the plugin scripts' `npx parley-mcp …` resolve to this repo. Confirm `parley-mcp doctor` runs.
2. **Install into your real user config:** `parley-mcp setup --harness claude-code`. It prints the
   files it changed: `~/.claude.json` (merged `mcpServers.parley`, including `env.PARLEY_HARNESS=
   claude`) and the marketplace tree under `~/.parley-mcp/claude-marketplace/`. It also runs
   `claude plugin validate | marketplace add | install` — watch for any error it reports.
3. **Verify the plugin actually loaded:** run `claude plugin list --json` and confirm `parley` is
   present and enabled. Then run `parley-mcp doctor`: it should say **can wake idle** (it checks the
   same `claude plugin list --json` plus the monitor files). If doctor says the plugin is not
   installed/enabled, re-run `claude plugin install parley@parley --scope user` and restart Claude.
4. **Restart any open session** so the new MCP server and plugin load. Monitors are experimental —
   ensure your Claude Code is recent enough (`docs/harness-notes.md` records the version floor).
5. **Open two sessions in one repo, different folders** (A in `<repo>/api`, B in `<repo>/web`). Each
   registers as `claude@api` / `claude@web` on SessionStart. `parley-mcp who` (in the repo) should
   list both as alive.
6. **Leave session B idle.** In session A type `say hi to claude@web`. Expect B's monitor to surface
   the message and the idle agent to answer **within 5 s with no typing in B**. Because the MCP tools
   now share the hooks' id, A's `talk` and B's hooks/monitor use one inbox.
7. **Confirm read receipts:** once B's reply (or its next prompt echoing the message id) lands,
   `parley-mcp log` / the viewer (M6) should show read ✓✓ / replied ↩.
8. **Capture fixtures:** save the real hook payloads Claude Code sends, anonymise paths/ids, replace
   the synthetic `src/adapters/claude-code/fixtures/*.json`, and keep the replay tests green.
9. **Uninstall check:** `parley-mcp uninstall`, then confirm `claude plugin list --json` no longer
   shows `parley`, `~/.claude.json` keeps your other keys, and `~/.parley-mcp/claude-marketplace/`
   is gone.

If step 6 fails within 5 s, check (assumptions in `docs/harness-notes.md`): the monitor's agent-id
derivation (`claude@$(basename "$PWD")`), whether the monitor's stdout reaches Claude as a
notification on your version, the parent-pid exit guard, and whether the plugin is enabled.

---

## M4 — Claude Code adapter (completed build 2026-11-07, session kiro-M4)

**Goal (PLAN section 6 "Claude Code" + section 7 + M4):** build `src/adapters/claude-code` — a
real harness adapter that registers the Parley MCP server at user level and installs a Claude Code
plugin (monitor + hooks), idempotent, with an exact uninstall. First fix the M3 review must-fix on
the fake adapter's uninstall and fold in the other M3 follow-ups.

**Step 1 — M3 review fixes (done first)**
- **Must-fix (recursive uninstall):** `src/adapters/fake/index.ts` used
  `rmSync(dirname(path), { recursive: true, force: true })`, which would delete the whole parent
  directory even if setup didn't create it or it held other files. Replaced with a shared helper
  `src/adapters/fs-ops.ts`: `removeFileIfPresent` (delete one file) and `removeDirIfEmpty` (remove a
  directory **only if empty**, never recursive). New test in `test/cli/setup.test.ts`: when the
  config's parent dir holds an unrelated `notes.txt`, uninstall removes only our file and leaves the
  sibling file and the directory intact. Covered directly by `test/adapters/fs-ops.test.ts`.
- **Other follow-ups:** (a) a `buildProgram`/commander test (`test/cli/program.test.ts`) runs
  `setup --dry-run` against a temp HOME and asserts nothing is written; (b) an unknown `--format`
  now errors via commander `.choices()` instead of silently defaulting (export + inbox drain/watch),
  with negative-path tests; (c) the `transport.onclose` close path stays covered by the M3
  `test/mcp/serve.test.ts`; (d) `DoctorReport` gained `hooksTrusted?: boolean | null` and the
  `Adapter` interface deviation (`env`, `dryRun`, `fake`) is documented in `src/adapters/types.ts`;
  (e) `overlap.ts` trailing newline confirmed.

**Built (Claude Code adapter)**
- `src/adapters/claude-code/plugin-files.ts` — constants that generate the plugin: `.claude-plugin/
  plugin.json`, `hooks/hooks.json` (SessionStart, UserPromptSubmit, Stop, PostToolUse with an
  `Edit|Write|MultiEdit` matcher + a catch-all, SessionEnd), `monitors/monitors.json` (the inbox
  monitor), and the per-event + monitor shell scripts that pipe stdin into `parley-mcp hook <event>`.
  User-level MCP registration targets `~/.claude.json` `mcpServers.parley`.
- `src/adapters/claude-code/install.ts` — `installClaudeCode` (merge `mcpServers.parley` into
  `~/.claude.json`; write the plugin files; idempotent, writing only missing/different files),
  `uninstallClaudeCode` (remove exactly the plugin files, prune only now-empty plugin dirs, unmerge
  the `parley` key and remove `~/.claude.json` only if it existed solely for us), `doctorClaudeCode`
  (installed? MCP wired? plugin present? can wake idle? `hooksTrusted: null` — Claude Code plugins
  need no per-hook trust).
- `src/adapters/claude-code/index.ts` — the `Adapter`; `detect` reports installed when `~/.claude`
  or `~/.claude.json` exists (never launches `claude`). Registered in `src/adapters/index.ts`.
- `src/cli/commands/hook-payloads.ts` + `hook-events.ts` — the five hook handlers (see Step 1 note
  above). Wired into `src/cli/index.ts` as `hook session-start|user-prompt|stop|post-tool|session-end`
  reading JSON from stdin.
- `src/adapters/claude-code/fixtures/*.json` — synthetic payloads (marked `"_synthetic": true`),
  replayed by `test/adapters/claude-code-fixtures.test.ts`.

**Tests**
- `test/adapters/claude-code.test.ts` — install writes the `mcpServers.parley` entry + plugin files;
  install twice is byte-for-byte; dry-run writes nothing; merge keeps unrelated `~/.claude.json`
  keys and other servers; uninstall removes exactly what it created, restores a pre-existing
  `~/.claude.json` byte for byte, and leaves a pre-existing `~/.claude/settings.json` + dir intact;
  doctor reports not-wired before and wired after; detect reflects `~/.claude`.
- `test/cli/hook.test.ts` — every handler ignores a subagent payload (`agent_type` or `agent_id`);
  session-start registers from the cwd basename; user-prompt marks read only when the id is present
  (and delivers-then-reads a still-sent message); post-tool drains + records an Edit; session-end
  requeues a delivered-unread message.
- `test/adapters/fs-ops.test.ts`, `test/cli/program.test.ts`, `test/cli/setup.test.ts` (new case),
  `test/adapters/claude-code-fixtures.test.ts`.

**Commands/results (via `wb run -- ...`)**
- `pnpm check` (eslint strict + tsc --noEmit + vitest): **passed** — 30 test files, **139 tests**.
- `wb verify`: **PASS** (`.workbench/tasks/M4/verification.json`) — all acceptance commands exit 0,
  scope checks ok, no new dependencies.

**Commits (local, not pushed)**
- `fix: remove only what install created and never recurse on uninstall`
- `feat: reject unknown --format values and cover setup --dry-run via buildProgram`
- `feat: add Claude Code hook event handlers with read-evidence and subagent guard`
- `feat: add the Claude Code adapter with user-level MCP registration and a plugin`

### (H) Human live two-session test — exact steps

This is M4's acceptance check (PLAN marks it **(H)**). The build cannot run `claude` itself and the
automated tests use a temporary HOME; a real run needs two Claude Code sessions.

1. **Build/link the CLI.** There is no published package yet, so make `parley-mcp` runnable, e.g.
   `pnpm build` is not wired until M12 — for now run the CLI via a local shim so the plugin scripts'
   `npx parley-mcp …` resolves to this repo (or temporarily alias `parley-mcp` to
   `node <repo>/dist|src entry`). Confirm `parley-mcp doctor` runs.
2. **Install into your real user config:** `parley-mcp setup --harness claude-code`. It prints the
   exact files it changed: `~/.claude.json` (merged `mcpServers.parley`) and the plugin under
   `~/.claude/plugins/parley/`. Review the printed list.
3. **Trust / enable the plugin** in Claude Code if it prompts (monitors are experimental; ensure
   your Claude Code is recent enough — notes.md records the version floor). Restart any open session
   so the new MCP server and plugin load.
4. **Open two sessions in one repo, different folders**, e.g. terminal A in `<repo>/api`, terminal B
   in `<repo>/web`. Each registers as `claude@api` / `claude@web` on SessionStart. Check with
   `parley-mcp who` (run in the repo) that both appear and are alive.
5. **Leave session B idle.** In session A type: `say hi to claude@web`. Expect session B's monitor to
   surface the message as a notification and the idle agent to answer **within 5 seconds with no
   typing in B**.
6. **Confirm read receipts:** once B's reply (or its next prompt echoing the message id) lands,
   `parley-mcp log` / the viewer (M6) should show the message progress to read ✓✓ / replied ↩.
7. **Capture fixtures:** while doing the above, save the real hook payloads Claude Code sends (from
   the debug log or a temporary logging wrapper), anonymise paths and ids, drop them into
   `src/adapters/claude-code/fixtures/` replacing the synthetic ones (keep the `_synthetic` flag
   false or remove it), and keep the replay tests green.
8. **Uninstall check:** `parley-mcp uninstall` then confirm `~/.claude.json` keeps your other keys
   and `~/.claude/plugins/parley/` is gone.

If step 5 does not deliver within 5 s, the likely causes to check (recorded as assumptions in
`docs/harness-notes.md`): the monitor's agent-id derivation (`claude@$(basename "$PWD")`), whether
the monitor's stdout truly reaches Claude as a notification on your version, and the parent-pid exit
guard. Write findings into `docs/harness-notes.md` (verified vs assumed).

---

## M3 — Results (completed 2026-11-07, session kiro-M3)

**Goal (PLAN section 7 / M3):** the `parley-mcp` CLI (commander) — `serve`, `who`, `log`,
`export`, `inbox drain|watch|register`, `hook edit`, and the `setup` / `uninstall` / `doctor`
frameworks driven by a fake adapter and the `Adapter` interface — plus the four M2 review
follow-ups from state.json `next_action`.

**M2 review follow-ups folded in**
1. **serve() close handling (high)** — `src/mcp/server.ts`: the db close handler is now registered
   **before** `server.connect` (and also on stdin `end`/`close`), so no close can be missed in the
   window between connect returning and the handler being set. `server.connect()` preserves and
   chains an existing `transport.onclose` (verified in the SDK's `shared/protocol.js`), so the
   SDK's own close handling is kept. `serve()` now returns a `ServeHandle` (`isClosed()`,
   `close()`) so the close path is observable. The misleading comment was corrected. New test
   `test/mcp/serve.test.ts` "closes the hub db when stdin ends".
2. **recipient-guard participant test (medium)** — `test/store/agreements.test.ts`: a third agent
   `c@r` that **is** a thread participant (it messaged `a@r` in the thread) but is **not** the
   agreement's recipient (`offered_to = b@r`) is refused; the real recipient `b@r` still succeeds.
3. **offered_to nullable vs required (medium)** — migration 2 added `offered_to TEXT` (nullable),
   but the Zod row schema requires it (`z.string().min(1)`). Pre-release, no production hub.db
   exists, so `offered_to TEXT NOT NULL` is folded into the initial schema (migration 1) and the
   separate nullable migration is dropped: the SQL column and the Zod schema now agree. `db.test.ts`
   maps `migrations` dynamically, so it still passes.
4. **tidy (low)** — removed the trailing blank lines in `src/core/overlap.ts`; the serve test
   closes its db/stream handles deterministically.

**Built (CLI)**
- `src/cli/context.ts` — `resolveRepoRoot` (git `rev-parse --show-toplevel`, cwd fallback, never
  throws), `resolveDbPath` (`~/.parley-mcp/hub.db`, `PARLEY_DB_PATH` override), `openHubDb`.
- `src/cli/index.ts` — the commander program (`buildProgram`) with injectable `{ write, env, cwd }`
  deps; `withDb` opens/closes the hub db per command; `serve`, `who`, `log`, `export`, `viewer`,
  `doctor`, `setup`, `uninstall`, and the `inbox drain|watch|register` + `hook edit` subcommands.
- `src/cli/bin.ts` — the `#!/usr/bin/env node` entry (packaging finalised in M12).
- `src/cli/commands/serve.ts` — resolves options and hands off to the M2 `serve()`; `start` is
  injectable for tests.
- `src/cli/commands/who.ts` / `log.ts` / `export.ts` — pure command functions taking an injected
  db + writer; who marks agents alive/idle via `core/identity.isAlive`; log prints a thread or
  lists threads; export writes md or jsonl of this repo's threads, messages and accepted decisions.
- `src/cli/commands/inbox.ts` — `runInboxDrain` (marks pending messages `delivered`, never `read`
  — read needs its own evidence, PLAN 4.3 — prints monitor/json lines), `runInboxRegister`
  (upsert + heartbeat), `runInboxWatchOnce` (one-message step; the poll loop lives in index.ts).
- `src/cli/commands/hook.ts` — `runHookEdit` records the edit then warns (never blocks) about
  overlap with other agents' active claims and recent same-file edits via `core/overlap.detectOverlap`.
- `src/cli/commands/viewer.ts` — stub pointing to M6.
- `src/adapters/types.ts` — the `Adapter` interface (PLAN section 6) + `InstallReport` /
  `DoctorReport` / `FileChange` types. `src/adapters/fake/index.ts` — the fake adapter.
  `src/adapters/index.ts` — the `ADAPTERS` registry.
- `src/cli/commands/setup.ts` / `uninstall.ts` / `doctor.ts` — drive the adapters; setup `--dry-run`
  lists changes and writes nothing, setup is idempotent, uninstall restores byte for byte.

**Tests**
- `test/cli/setup.test.ts` — setup `--dry-run` lists changes and writes nothing; setup twice is
  byte-for-byte identical the second time; uninstall of a created file removes it entirely;
  uninstall of a merged file restores the original bytes exactly; doctor flips readiness after setup.
- `test/cli/commands.test.ts` — who (alive/idle, empty), log (list + print + wrong-repo), export
  (md with decisions, jsonl parseable per line), inbox drain (monitor + json, delivered-not-read,
  second drain empty), watch --once, register, hook edit (overlap warning + no overlap), and the
  serve command resolving options to an injected `start`.
- `test/mcp/serve.test.ts` — added the stdin-end close-path test; existing talk-over-stdio test
  keeps its handles closed deterministically.
- `test/store/agreements.test.ts` — added the participant-not-recipient case.

**Commands/results (via `wb run -- ...`)**
- `pnpm add commander` → commander 15.0.0 (PLAN-approved runtime dep).
- `pnpm check` (eslint strict + tsc --noEmit + vitest): **passed** — 25 test files, 107 tests.
- `wb verify`: **PASS** (`.workbench/tasks/M3/verification.json`) — all acceptance commands exit 0,
  scope + dependency (`new-dependency` approval) checks ok.

**Note on prettier**: `pnpm run format` (prettier --write .) reformats the whole repo, including
previously committed M1/M2 files and docs, because earlier milestones did not run it. It is **not**
part of `pnpm check` (the verify gate is lint + typecheck + test). That churn was reverted so the
M3 diff stays scoped; running `format` repo-wide is left for a dedicated formatting pass if the
human wants one.

**Commits (local, not pushed)**
- `fix: fold M2 review follow-ups into serve lifecycle, schema and tests`
- `chore: add commander runtime dependency for the CLI`
- `feat: add the parley-mcp CLI program and wire the serve command`
- `feat: add who, log, export, inbox and hook-edit CLI commands`
- `feat: add the adapter framework with setup, uninstall and doctor`

**Assumptions (M3)**
- `resolveRepoRoot` uses git top-level with a cwd fallback and never throws (a non-repo folder is
  still a valid place to talk; discovery then groups by that folder path).
- The fake adapter's user-level file is `~/.parley-fake/config.json` with a managed `parley` key;
  its JSON is pretty-printed with a trailing newline so a rewrite round-trips exactly, which is
  what makes the byte-for-byte uninstall check deterministic. Real harness config paths/formats are
  M4+ and recorded in `docs/harness-notes.md`.
- `inbox watch` polls every 2 s in the command wiring; the pure `runInboxWatchOnce` step is what
  tests drive (no real sleeping in tests).
- The CLI `bin` entry (`src/cli/bin.ts`) exists but the package.json `bin` field and the compiled
  path are deferred to M12 (launch polish), since there is no build pipeline yet.

**Next (per PLAN)**
- M4 (Claude Code adapter), or M3b (the work harness adapter) once `docs/harness-notes.md` names it.

---

## M2 — Results (completed 2026-11-07, fixed review round 1 soft_fail)

**Built** (M2 MCP server, `src/cli` untouched — the `serve` command wiring is deferred to M3, recorded as an assumption in state.json)
- `src/mcp/server.ts` — `createServer(ctx)` wires talk/inbox/agree to an `McpServer`; `serve()` opens the hub db once, runs retention, registers the agent, connects `StdioServerTransport`, and keeps the db open until `transport.onclose` (harness disconnect) instead of closing in a `finally` right after connect. Only file importing the SDK. Accepts optional `dbPath`/`stdin`/`stdout` for tests.
- `src/store/migrations.ts` — migration id 2 `add_agreement_recipient`: adds `agreements.offered_to TEXT` + index.
- `src/store/schema.ts` — `agreements` row gains required `offered_to` (`AgreementRow.offeredTo`).
- `src/store/repos/agreements-repo.ts` — `insertAgreement` takes `offeredTo`; `updateAgreementStatus` now guards on `status='offered' AND answered_by <> offered_by AND offered_to = answered_by` (only the stored recipient may answer).
- `src/mcp/tools/agree.ts` — offers store `offered_to` = thread recipient; counter validates `text` before touching the store and performs the original→`countered` update plus the counter insert in one `db.transaction`; `agree claim` reports only **other agents'** active overlapping claims (PLAN 4.5); uses `globMatch` directly.
- `src/core/overlap.ts` — removed the `claimsOverlap` alias (keep `detectOverlap`).
- `src/store/repos/messages-repo.ts` — `listMessagesFromAgent` no longer does the no-op `JOIN threads`.
- All other M2 files from the original build (identity, guards, context, response, rules, outlook, talk, inbox, core identity/message-rules/threads, store schema/messages-repo) unchanged.

**Tests**
- `test/mcp/serve.test.ts` — drives `serve()` over a real stdio stream pair, makes a `talk` call, and confirms the write committed to the still-open hub db (finding 1).
- `test/store/agreements.test.ts` — offers to b@r; a 3rd agent c@r's accept is refused and the row stays `offered`; b@r's accept succeeds; counter-proposal offered to a@r (finding 2).
- `test/mcp/agree.test.ts` — claim conflicts report other agents only (never the caller's own); textless counter refused and original stays `offered`; proper counter marks original `countered` and adds a new offered counter row (findings 3 & 5).
- `test/mcp/integration.test.ts` — a reply moves the original to `replied`; a third agent's MCP `accept` is refused with `not_answerable`; `structuredContent` asserted on talk/inbox/agree (finding 4).
- `test/mcp/outlook.test.ts` — `buildOutlook` (never-checked-in / active / idle) and `pluralOutlook` (finding 4).
- `test/mcp/rules.test.ts` — `rulesReminder` and `readRulesFile` present/absent (finding 4).
- `test/core/guards.test.ts` — secret near-misses: too-short AKIA / xoxb / .env value must not block; real patterns still blocked (finding 4).
- `test/core/threads.test.ts` — `titleFromFirstMessage` moved here from `test/core/fanout-and-cap.test.ts` (finding 5).
- `test/core/fanout-and-cap.test.ts` — `titleFromFirstMessage` test removed (now in threads.test.ts).

**Commands/results (via `wb run -- ...`)**
- `pnpm check` (eslint + tsc --noEmit + vitest): **passed** — 23 test files, 87 tests passed.
- `wb verify`: **PASS** (all acceptance commands exit 0; `.workbench/tasks/M2/verification.json`).

**Commits (local, not pushed)**
- `docs: frame M2 MCP server workbench task`
- `chore: add @modelcontextprotocol/sdk runtime dependency`
- `fix: guard agreement answers, move guard compositions to the mcp layer, and add near-miss secret tests`
- `feat: add MCP server with talk/inbox/agree over stdio`
- `feat: keep serve() db open until the stdio transport closes`
- `fix: guard agreement answers on stored recipient; make counter atomic`
- `fix: report claim conflicts for other agents only; drop claimsOverlap alias and no-op JOIN`
- `test: add outlook, rules, secret and claim-conflict tests; extend integration test`

**M2 — Review round 1 fixes (2026-11-07, session opencode-M2-fix)**
Independent review `.workbench/tasks/M2/review.json` scored M2 `soft_fail` (5/10). All five findings fixed, each with a test that fails on the pre-fix code:
1. **serve() db lifecycle (high)** — db now stays open until `transport.onclose`; new `test/mcp/serve.test.ts` drives `serve()` over a stream pair and makes a real talk call.
2. **Agreement recipient stored + guarded (medium)** — new migration `agreements.offered_to`; answers guarded on `offered_to`; 3-agent test refuses a third agent's accept.
3. **Counter validate-first + single transaction (medium)** — counter text validated before any write; both writes in one `db.transaction`; textless counter can't orphan the original.
4. **Integration + missing unit tests (medium)** — integration asserts reply→replied, refuses a forbidden MCP answer, asserts structuredContent; new unit tests for outlook, secret blocking, rules reminder, claim conflicts.
5. **Claim conflicts / cleanup (low)** — claim conflicts exclude the caller's own claims; `claimsOverlap` alias removed; no-op `JOIN` removed from `listMessagesFromAgent`; `titleFromFirstMessage` test moved to `test/core/threads.test.ts`.

**Next (per PLAN)**
- M3: CLI basics (who, log, export, inbox drain/watch/register, hook edit, setup/uninstall/doctor frameworks). Or M3b (work harness adapter) when the human names it.


## M1 — Store and core (plan, 2026-11-07, session opencode-M1)

**Goal (PLAN.md M1):** Schema, migrations, repositories with Zod row parsing; identity, message state machine, threads, agreements, claims, overlap, guards (cap, stop-all, secret scan), retention, cost estimate.

**Workbench:** `wb mode checkpoints --session opencode-M1`; task `M1` framed (`.workbench/tasks/M1/`). Commands run through `wb run -- <cmd>`; commit after each task; never push.

**Plan**
1. **deps** — Add PLAN-approved deps: runtime `better-sqlite3`, `zod`; dev `@types/better-sqlite3`. Keep lockfile in sync. Proof: `pnpm check` passes.
2. **store** (`src/store/`, `test/store/`) — SQLite connection (WAL, busy timeout), numbered migrations, Zod row schemas, repositories per table (agents, threads, messages, message_events, agreements, claims, edits, settings) with hot-query indexes. In-memory DB for tests.
3. **core** (`src/core/`, `test/core/`, pure logic) — identity; message state machine (guarded `UPDATE … WHERE status=<prev>`, idempotent send via `idempotency_key`, requeue unread delivered messages, 24h expiry, `everyone` fan-out, read-evidence rules); threads/guards (message cap → `paused` + `thread_paused`, `stop_all`, secret scan returning `secret_blocked` kind never value); agreements; claims (2h expiry/renew/release); overlap (post-edit check vs active claims + same-file edits in last 30m); retention (30-day delete on start); cost estimate (chars/4, labeled estimate).
4. **verify** — Every M1 acceptance has a test; `pnpm check` and `wb verify` pass; update PROGRESS/state/handoff; stop.

**M1 acceptance checks (all must have tests)**
- Every status move (including guarded no-ops, requeue and expiry), idempotent sends, `everyone` fan-out, cap → paused, secret blocking for each pattern, claim expiry, overlap detection, and 30-day retention.

**Constraints:** no `any`, no `as` (only `as const`), no files >400 lines, core pure/no I/O (store handles I/O), Zod-parse at boundaries, tests use in-memory SQLite.

## M1 — Results (completed 2026-11-07)

**Built**
- `src/store/`: `db.ts` (open SQLite with WAL + busy timeout, numbered migrations runner), `migrations.ts` (initial schema + indexes for hot queries), `schema.ts` (Zod row schemas/types), `parse.ts` (Zod row parsing helpers), `retention.ts` (FK-safe 30-day delete), repos for `settings`, `agents`, `threads`, `messages` (insert/idempotent insert, guarded status updates enforcing state machine, requeue delivered-unread, expiry, undelivered listing), `message_events`, `agreements`, `claims` (renew/release/active listing), `edits`.
- `src/core/` (pure): `identity.ts`, `cost.ts` (chars/4 estimate + label), `guards.ts` (secret scan returning kind only, never value), `message-rules.ts` (transition rules, `everyone` fan-out expansion), `threads.ts` (cap/paused checks), `claims.ts` (2h TTL/expiry/active), `glob.ts` + `overlap.ts` (claim + recent same-file edit conflicts, 30m window), `agreements.ts` (answer/status rules), `retention.ts` (cutoff).
- Tests (`test/store/`, `test/core/`, in-memory SQLite): `test/store/messages.test.ts` (status moves sent→delivered→read→replied and sent→failed, guarded no-ops, requeue, expiry, idempotent sends incl. current-status retry), `test/core/fanout-and-cap.test.ts` (`everyone` fan-out expansion + row-per-recipient same thread; cap→paused checks and integration), `test/core/guards.test.ts` (every secret pattern: AWS AKIA, GitHub `ghp_`/`github_pat_`, `sk-` OpenAI/Anthropic-style, Slack `xox*`, private-key PEM header, `.env`-style `SECRET=`/`TOKEN=` lines; kind-only result), `test/core/claims.test.ts` + `test/store/claims.test.ts` (2h expiry, renew, release), `test/core/overlap.test.ts` (active claim conflict, recent same-file edit in 30m, ignores own/inactive/old/other-file), `test/store/retention.test.ts` (deletes messages, events, agreements, edits older than 30 days; keeps recent). Also `test/store/db.test.ts` (numbered migrations applied/idempotent) and core smoke tests.

**Commands/results (via `wb run -- ...` where applicable)**
- `pnpm add better-sqlite3 zod`; `pnpm add -D @types/better-sqlite3`; configured pnpm build approvals for `better-sqlite3`; `pnpm rebuild better-sqlite3`.
- `pnpm check` (eslint + `tsc --noEmit` + vitest): **passed** — 11 test files, 39 tests passed (final run recorded by `wb verify`).
- `wb verify`: **PASS** (`.workbench/tasks/M1/verification.json`) — acceptance commands all exited 0 (`pnpm check` + targeted vitest runs for status moves/idempotency/fan-out/cap/guards/claims/overlap/retention); scope/dependency checks passed (`package.json` changed with `new-dependency` approval).

**Commits (local, not pushed)**
- `docs: frame M1 store and core workbench task`
- `chore: add M1 runtime dependencies better-sqlite3 and zod`
- `feat: add M1 SQLite store, migrations, and repositories`
- `feat: implement M1 core logic and acceptance tests`
- `docs: record M1 store and core results`
- `chore: add M1 workbench handoff`
- `chore: default OpenCode to the free GLM-5.3-Flash model` (user-requested, out of M1's build scope)
- `chore: record the user's approval of the opencode.json change and M1 review round 1`
- `fix: retention deletes all events of removed messages to keep FKs safe`
- `fix: add enforceMessageCap so the store composes count, cap and pause`
- `feat: make stop_all a real guard composing setting and core decision`
- `test: cover agreement offer, accept, counter, reject and recipient-only answers`
- `feat: allow delivered->replied, stamping read_at since a reply implies read`
- `docs: record M1 review round 1 fixes`
**Notes/decisions**
- Guarded message transitions are enforced by the store using the valid state machine (`sent→delivered→read→replied`, `sent→failed`) as guarded `UPDATE … WHERE status IN (...)` no-ops.
- Retention deletion runs in FK-safe order (events before messages).
- `better-sqlite3` required native build approval in pnpm 11 (`pnpm-workspace.yaml` `onlyBuiltDependencies`).

## M1 — Review round 1 fixes (2026-11-07, session opencode-M1-fix)

Independent review `.workbench/tasks/M1/review.json` scored M1 `soft_fail` (5/5 with high/medium/low findings). Fixes on `main` (2026-11-07), kept inside M1's scope (`src/store/**`, `src/core/**`, `test/**`, `.workbench/**`, `docs/PROGRESS.md`):

1. **Retention FK safety (high)** — `applyRetention` used to delete only events older than the cutoff, so a message older than 30 days with a newer event (e.g. a recent expiry event) hit a FOREIGN KEY error and rolled the whole retention back. `src/store/repos/message-events-repo.ts` now deletes **all events of the messages being removed** (`DELETE ... WHERE message_id IN (SELECT id FROM messages WHERE sent_at < ?)`, `deleteEventsOfMessagesSentBefore`), keyed on `messages.sent_at`. New test: old message + newer event → retention succeeds, both removed (`test/store/retention.test.ts`).
2. **Production cap pause (medium)** — the cap test previously set `paused` itself. Added `threadsRepo.enforceMessageCap(db, threadId)` in `src/store/repos/threads-repo.ts`: I/O composition (count + cap + pause) that calls the pure core decision `core/threads.ts shouldPauseAfterCount` and pauses an `open` thread at its cap. The test now calls `enforceMessageCap`, asserts `DEFAULT_MESSAGE_CAP === 20`, and a below-cap thread stays open. Mutation check: making `shouldPauseAfterCount` return `false` **and** setting `DEFAULT_MESSAGE_CAP` to 200 both make the test fail (recorded in `.workbench/feedback.jsonl`), then reverted and tests pass again.
3. **stop-all logic (medium/low)** — replaced the pointless `isStopAll(stopAll): stopAll` with a real guard: `core/guards.ts checkStopAll(stopAll) -> { ok: true } | { ok: false, code: "stop_all" }` (blocks every `talk` until the human turns it off, PLAN 4.4), plus store composition `settingsRepo.checkStopAllActive(db)` reading the `stop_all` setting. Tests: `test/core/guards.test.ts` (on/off decision) and new `test/store/stop-all.test.ts` (setting persists, toggles, guard composes).
4. **Agreement tests (low)** — new `test/core/agreements.test.ts` (accept/counter/reject/veto status mapping; only the recipient may answer an `offered` agreement; settled agreements can't be re-answered) and `test/store/agreements.test.ts` (offer → accept/counter/reject by the recipient; a non-recipient's answer is refused and the row stays `offered`; counter-proposal keeps `parent_id`).
5. **delivered → replied (low, PLAN 4.3 “read needs evidence … or when it replies”)** — a reply implies read, so the state machine now allows `delivered → replied`: `core/message-rules.ts` transitions and `messagesRepo.ALLOWED_FROM.replied = ["delivered","read"]`, with `guardedStatusUpdate` stamping `read_at = COALESCE(read_at, ?)` (replied timestamp; an earlier `read_at` is kept). Tests: direct `delivered → replied` stamps `read_at` and `replied_at`; `delivered → read → replied` keeps the earlier `read_at`; `failed` stays a no-op afterwards.
6. **Assumptions recorded (low)** — builder choices now listed in `.workbench/state.json assumptions` and below under “Assumptions”.
7. **pnpm-workspace.yaml change explained (low)** — see “pnpm-workspace.yaml build approvals”.

**Assumptions (recorded this session)**
- **Secret thresholds**: scan regex minimum lengths are heuristics — AWS `AKIA` + 16 chars; `ghp_`/`github_pat_`/`sk-` tokens ≥ 20 chars; Slack `xox*-` ≥ 10; `.env`-style `SECRET|TOKEN|PASSWORD|API_KEY=<12+ char value>` lines. Tunable after feedback; the value is never surfaced.
- **Fan-out keys**: per-recipient idempotency keys are `<base key>::<toAgent>` for `to: "everyone"`.
- **Glob semantics** (claims): `*` within one path segment, `**` across segments (`**/` also matches zero directories), `?` one non-separator char; no character classes.
- **Retention keying**: on `messages.sent_at` (and `agreements.created_at`, `edits.at`); events of removed messages are deleted regardless of their own timestamps.
- **busy_timeout**: 5 s by default with WAL journal (concurrent writers wait briefly rather than erroring).
- **Reply implies read**: `read_at` is stamped with the reply timestamp when replying from `delivered`; an earlier explicit `read_at` is preserved.

**pnpm-workspace.yaml build approvals**: M1 added `better-sqlite3`, which has a native build script. Under the installed pnpm 11.22, approved build scripts are whitelisted in `onlyBuiltDependencies` (the mechanism `pnpm approve-builds` and the longer `postinstall` warnings point to), and the scaffold's `allowBuilds: esbuild: true` mapping was replaced by the same entry in that list. `esbuild` stayed approved; only the unused key was dropped. Verified by `pnpm rebuild better-sqlite3` succeeding and `pnpm check` passing (native module imports and runs).

**Verification (via `wb run --`)**, all exit 0:
- `pnpm check` — lint + typecheck + 14 test files, **55 tests** passed (M1 round 1 had 39).
- Targeted: `test/store/retention.test.ts` (incl. old-message/newer-event case), `test/core/fanout-and-cap.test.ts` (incl. `enforceMessageCap` + `DEFAULT_MESSAGE_CAP = 20`), `test/core/guards.test.ts` + `test/store/stop-all.test.ts`, `test/core/agreements.test.ts` + `test/store/agreements.test.ts`, `test/store/messages.test.ts` (incl. delivered→replied stamping), `test/store/db.test.ts`, `test/core/claims.test.ts` + `test/store/claims.test.ts`, `test/core/overlap.test.ts`.
- `wb verify` — **PASS** (all 11 checks: 8 acceptance commands exit 0, scope and dependency checks ok; `.workbench/tasks/M1/verification.json` round 2).


**Next (per PLAN)**
- M2: MCP server (`serve`) with `talk`, `inbox`, `agree` over stdio (official SDK). Note PLAN’s work-harness-first instruction: build M3b when the work harness is named, before M4; M2/M3 follow in order.

---
