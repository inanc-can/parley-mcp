# Parley MCP: build plan

Status: design settled 2026-11-07. Build has not started.
Visual version of the decisions: `../plans/agent-talk-design.html` in the parent folder.

## 1. What we are building and for whom

**The user** is a developer who runs several coding agents on one laptop, for example Claude Code
in one terminal and Codex in another, both in the same repository. Today the agents can't see each
other: they edit the same files, and the developer copies messages between them by hand.

**After Parley MCP**, the developer runs one command. From then on their agents:
1. **find each other** automatically (agents in the same repo see each other),
2. **message each other**, and a message reaches an agent **even when it is idle**, within 5 seconds,
3. **settle who does what** with light file claims, overlap warnings and **written agreements**
   (one agent offers, the other accepts or counters),
4. while the developer **watches every conversation live** in a local web page, can post into any
   thread, pause it, or stop everything.

**Why the project exists:** it is a free open-source portfolio project. Success means people install
and use it. So the priorities are a first run that works within 2 minutes, flawless delivery on the
four launch harnesses, a small token cost, and a clean codebase.

**What makes it different from similar tools** (Concord, MCP Agent Mail): agents can reach
**written agreements**, the developer **steers** conversations, and the tool stays small: three tools,
no instruction files, nothing written into repos.

## 2. Final decisions

Grouped as on the design page. Treat this table as the spec.

### Install and discovery
| Topic | Decision |
|---|---|
| Install | `npx mcp-parley setup`. The npm name `mcp-parley` belongs to an unrelated package; the human chose `mcp-parley` (2026-11-07). Installed configs never call `npx`: setup writes the absolute path to this install's CLI |
| Setup scope | **User-level config only.** Nothing written into any repository |
| Launch harnesses | **Claude Code, Codex, Cursor, Grok Build**, each one working fully |
| Integration form | Native plugin or hooks per harness, plus the MCP server |
| Agent name | Harness + folder name, e.g. `codex@api`, with a numeric suffix on clashes (`codex@api-2`) |
| Identity persistence | Stable per harness + folder: a restarted agent keeps its name and inbox |
| Discovery | Agents in the **same repository** see each other (repo = git top-level path) |
| Presence | The adapter sends a heartbeat while the session runs; "alive" = heartbeat within 30 s |
| First run | Setup ends by suggesting one sentence to type, e.g. `say hi to codex@api` |
| Teaching agents | **Short MCP tool descriptions only.** No CLAUDE.md / AGENTS.md edits (Cursor and Grok get a short hint through hook output, see section 6) |

### Messaging
| Topic | Decision |
|---|---|
| Waking idle agents | Each harness's own mechanism (hook, monitor, IPC); see section 5 |
| Latency target | Under 5 seconds to an idle agent |
| Receipts | sent ✓, delivered ✓✓, read (blue ✓✓), replied ↩, failed ✕ |
| Offline recipient | Queue the message; it expires after 24 hours |
| Message kinds | `text`, `question`, `proposal`, `file_ref`, `handoff`, `request` |
| Addressing | One agent, or `everyone` (all agents in the repo) |
| Busy recipient | Deliver at the next safe point (after a tool call or at turn end); never interrupt |
| Waiting for a reply | Allowed, with a timeout (default 120 s, max 600 s) |
| Runaway guard | 20 messages per thread by default, then the thread pauses and the human is notified |
| Cost | Shown on every thread (see the note in section 4.6) |

### Agreeing who does what
| Topic | Decision |
|---|---|
| Claims | Light claims on paths or globs, expiring after 2 hours unless renewed |
| Claim conflict | Warn both agents; never block |
| Overlap detection | From **actual edits** seen by post-edit hooks, compared against claims and other agents' recent edits |
| Overlap unit | Same file |
| Agreements | Offer → accept, counter, or reject. Accepted agreements go into the repo's decisions log |
| Human approval | Agreements are shown to the human, who can veto within the viewer |
| Handoff | A message of kind `handoff` with summary, files touched, open questions, tests run |
| Decisions log | Per repo, stored in SQLite, readable by agents through `inbox` |
| Roles | None in v1 |
| Delegation | Kind `request`; the recipient accepts or declines |

### The human stays in control
| Topic | Decision |
|---|---|
| Viewer | Local web page on `127.0.0.1`, opened with `mcp-parley viewer` |
| Notifications | OS notification for agreements, conflicts and paused threads |
| Human posting | The human posts into threads as participant `you` |
| Stop controls | Pause or resume per thread, plus a stop-all switch |
| Sharing rules | Optional plain-text rules file, `.parley/rules.md` in a repo, created only by the human |
| Secrets | Outgoing messages containing obvious keys or tokens are blocked |
| Retention | 30 days, then deleted |
| Export | Markdown and JSONL |
| Telemetry | Opt-in anonymous counts, off by default. **Not built until the human decides** (M11) |
| Network | Only for optional features the user turns on. v1 has none |

### Open source and growth
| Topic | Decision |
|---|---|
| Language | TypeScript on Node ≥ 22 (changed from ≥ 20 by the human, 2026-11-10: Node 20 is end-of-life and pnpm 11 cannot run on it) |
| Storage | One SQLite file per machine: `~/.mcp-parley/hub.db` |
| Adapters | One folder per harness with a manifest; outsiders add new harnesses in one PR |
| Adapter tests | Against recorded harness sessions (fixtures of real hook payloads and outputs) |
| MCP tools | Three: `talk`, `inbox`, `agree` |
| Cross-machine | Not in v1. Keep the design ready for a self-hostable relay later |
| Name, license | Parley MCP, MIT |

## 3. Architecture

```
 Claude Code ─┐                                   ┌─ viewer (127.0.0.1, SSE)
 Codex ───────┤  MCP server (stdio, per session)   │       ▲
 Cursor ──────┼─► talk · inbox · agree ──► core ──► store ─┘
 Grok Build ──┘        ▲                      (pure)  (SQLite ~/.mcp-parley/hub.db)
                       │
     adapters: hooks, monitors and IPC that WAKE a session and DELIVER messages
     (they call `mcp-parley inbox drain` / `inbox watch`, which read the same store)
```

There is **no always-running daemon**. Every process (the MCP server for each session, hook
commands, monitors, the viewer) opens the same SQLite file in WAL mode, with a busy timeout. The
"hub" in the design is this shared file plus the core logic.

### Repository layout

```
parley-mcp/   (repo folder; the package and CLI are named mcp-parley)
  src/
    store/       connection.ts, schema.ts, migrations, one repository file per table, row schemas (Zod)
    core/        identity.ts, messages.ts (state machine), threads.ts, agreements.ts, claims.ts,
                 overlap.ts, guards.ts (loop cap, secrets, rules), cost.ts, retention.ts
    mcp/         server.ts, tools/talk.ts, tools/inbox.ts, tools/agree.ts
    cli/         index.ts (commander), commands/: setup, who, log, export, doctor, viewer, inbox, hook
    adapters/
      types.ts   the Adapter interface
      claude-code/  manifest.json, install.ts, plugin/ (hooks.json, monitors.json, scripts), fixtures/
      codex/        manifest.json, install.ts, bridge.ts, fixtures/
      cursor/       manifest.json, install.ts, fixtures/
      grok/         manifest.json, install.ts, plugin/, fixtures/
    viewer/      server.ts (node:http + SSE), static/ (index.html, app.ts, styles.css)
    notify/      os-notify.ts
  test/          mirrors src/
  docs/          PLAN.md, PROGRESS.md, harness-notes.md, adding-a-harness.md
```

### Dependencies (allowed list)

Runtime: `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `commander`, `smol-toml` (Codex config).
Dev: `typescript`, `vitest`, `eslint` + `typescript-eslint`, `prettier`, `esbuild` (viewer bundle),
`@types/better-sqlite3`, `@types/node`.
Anything else needs the human's approval. The viewer uses no UI framework: plain TypeScript and DOM.

## 4. Core behaviour

### 4.1 Identity

- An agent id is `<harness>@<folder>` where folder is the basename of the session's working
  directory. Clashes within one repo get `-2`, `-3`.
- The adapter maps the harness's native session id to the agent id. Restarting the harness in the same
  folder reuses the same agent id and inbox (stable identity).
- How the session id reaches us differs per harness. Claude Code exports `CLAUDE_CODE_SESSION_ID` to
  child processes; Codex passes its session id to hooks on stdin, not in the environment; Grok's
  `monitor` tool does not pass its session id. **Verify each one** and write the result in
  `docs/harness-notes.md`.
- The human is the participant `you`.

### 4.2 Data model (SQLite)

```
agents        id PK, harness, folder, repo_root, native_session, last_heartbeat, created_at
threads       id PK, repo_root, title, status (open|paused|closed), message_cap, created_at
messages      id PK, thread_id, from_agent, to_agent (agent id | 'everyone'), kind, body, payload_json,
              reply_to, status (sent|delivered|read|replied|failed), error_code,
              sent_at, delivered_at, read_at, replied_at, failed_at, expires_at,
              delivered_session, idempotency_key UNIQUE(from_agent, idempotency_key), est_tokens
message_events id PK, message_id, event, at, detail_json        -- every status change, for the viewer
agreements    id PK, thread_id, repo_root, text, status (offered|accepted|countered|rejected|vetoed),
              offered_by, answered_by, parent_id (for counters), created_at, answered_at
claims        id PK, repo_root, agent_id, path_glob, expires_at, released_at
edits         id PK, repo_root, agent_id, path, at                 -- from post-edit hooks
settings      key PK, value                                        -- e.g. stop_all, telemetry_opt_in
```

Add indexes for the hot queries: undelivered messages per recipient, claims per repo, edits per path
in the last hour. Migrations are numbered, run at startup and tested.

### 4.3 Message lifecycle

- `sent` is set only after the INSERT commits. A retry with the same `idempotency_key` returns the
  stored message and its current status, never a duplicate.
- `sent → delivered → read → replied`, and `sent → failed` (expired after 24 h, or the thread was
  stopped). Each move is a guarded `UPDATE … WHERE status = <previous>`; repeating one is a no-op.
- **Read needs evidence.** It is set only when the message id is seen in the model's input (Claude
  Code: `UserPromptSubmit` prompt or the transcript), when the recipient calls `inbox`, or when it
  replies. Never mark read from timing. A harness without evidence shows delivered until a reply.
- **Requeue:** messages delivered to a session that ended without reading them go back to `sent`
  when the same agent starts a fresh session.
- `to: 'everyone'` fans out into one message row per recipient, sharing a thread.

### 4.4 Threads, guards and stop controls

- Every message belongs to a thread. A new conversation creates one; replies stay in it.
- When a thread reaches its message cap (default 20), it becomes `paused`. New `talk` calls in it
  return `thread_paused`, and the human gets a notification. The human can resume it (adds 20 more)
  or close it.
- `stop_all` blocks every `talk` call until the human turns it off in the viewer.
- **Secret scan** before storing: block messages that match common key formats (AWS `AKIA…`, GitHub
  `ghp_`/`github_pat_`, OpenAI and Anthropic `sk-…`, Slack `xox…`, private-key PEM headers, and
  `.env`-style `SECRET=`/`TOKEN=` lines with long values). Return `secret_blocked` with the kind of
  secret found, never the value.
- **Rules file:** if `.parley/rules.md` exists in the repo, `talk` and `inbox` include a one-line
  reminder that rules exist, and `inbox` returns the rules text once per session.

### 4.5 Claims and overlap

- `agree` with `action: "claim"` records a path glob for 2 hours. Renewing extends it; `release` ends it.
- Post-edit hooks call `mcp-parley hook edit` with the edited path. It stores the edit and checks it
  against active claims by other agents and edits of the same file by another agent in the last 30
  minutes. On a conflict, both agents get a system message in a thread named after the file, and the
  human gets a notification. Nothing is blocked.

### 4.6 Cost

Harnesses don't tell an MCP server how many tokens they spend. Show **"≈ tokens moved through
Parley"** per thread, estimated as message characters ÷ 4 (`est_tokens`), and label it as an
estimate. Where a harness exposes real usage (the Claude Code transcript does), add it later. Do not
invent numbers.

### 4.7 Retention

On every MCP server start, delete messages, events, agreements and edits older than 30 days.

## 5. MCP tools

Descriptions must stay short: the three tool definitions together should be **under 1,500 tokens**.
Every tool returns `structuredContent` plus a one-paragraph text summary.

### `talk`: send, reply, broadcast
```
{ to: string            // agent id, or "everyone"
  text: string
  kind?: "text"|"question"|"proposal"|"file_ref"|"handoff"|"request"   // default "text"
  payload?: object      // file_ref: {path, lines?}; handoff: {summary, files, open_questions, tests}
  thread_id?: string    // omit to start a new thread
  reply_to?: string     // message id
  wait_for_reply_s?: number   // 0–600, default 0
  idempotency_key: string }
→ { message_id, thread_id, status, outlook, reply? }
```
`outlook` is one honest sentence: for example "codex@api is idle; its monitor will deliver this
within seconds", or "codex@api is offline; queued until it starts, expires in 24 h".

### `inbox`: read messages, receipts and decisions
```
{ thread_id?: string, include_sent?: boolean, include_decisions?: boolean, who?: boolean }
→ { messages[], sent_receipts[], decisions[], agents[] (when who) }
```
Reading your own inbox marks returned messages as read. It never shows another agent's inbox.

### `agree`: agreements and claims
```
{ action: "offer"|"accept"|"counter"|"reject"|"claim"|"renew"|"release",
  thread_id?: string, agreement_id?: string, text?: string, path_glob?: string }
→ { agreement? , claim?, conflicts[] }
```
`accept`, `counter` and `reject` are only allowed for the agent the offer was made to. Accepted
agreements notify the human, who can veto them in the viewer (status `vetoed`; both agents get a
system message).

## 6. Harness adapters

Each adapter implements:
```ts
interface Adapter {
  harness: 'claude-code' | 'codex' | 'cursor' | 'grok';
  detect(): Promise<{ installed: boolean; version?: string }>;
  install(): Promise<InstallReport>;     // user-level config only, idempotent, merges never overwrites
  uninstall(): Promise<InstallReport>;   // removes exactly what install added
  doctor(): Promise<DoctorReport>;       // can it wake an idle session right now? why not?
}
```
The **mechanisms below come from Concord's documentation (November 2026) and are unverified.**
First confirm each against the harness's current official docs and a real session, then record what
you found in `docs/harness-notes.md`. Concord's code for each harness is a useful map:
`plugin/concord-relay/` and `docs/claude-code.md` (Claude Code), `src/relay/codex-client.ts` and
`docs/codex.md` (Codex), `plugin/cursor/` and `docs/cursor.md` (Cursor), `plugin/grok/` and
`docs/grok-build.md` (Grok).

### Claude Code
- MCP server registered at user level (`claude mcp add --scope user parley -- npx mcp-parley serve`,
  or the equivalent config entry).
- A Claude Code **plugin** with:
  - a **monitor** (`monitors.json`): a script that runs `mcp-parley inbox drain --format monitor`
    every 2 s for the life of the session and prints one line per message. Each printed line becomes a
    notification and **wakes an idle session**. The script must exit when its parent harness process
    is gone, and exit at once in folders with no Parley agents.
  - hooks: `SessionStart` (register agent, heartbeat), `UserPromptSubmit` and `Stop` (read evidence),
    `PostToolUse` (drain at safe points; plus `hook edit` for Edit/Write tools), `SessionEnd`
    (requeue unread).
- Ignore hooks fired by subagents: their payload carries an agent id, and they don't prove that the
  main agent saw anything.

### Codex
- MCP server in `~/.codex/config.toml` under `[mcp_servers.parley]` (merge with `smol-toml`, keep
  everything else).
- Lifecycle hooks for register, drain at safe points and edits. Codex asks the user to **trust new
  hooks**: setup must tell the human to do this.
- **Idle wake** via Codex's app-server: `turn/start` for an idle thread, or `turn/steer` with
  `expectedTurnId` for a busy one. We only steer at safe points, so prefer queuing until the turn
  ends, then `turn/start`. Gate this to the protocol version you verified and fail closed: if the
  app-server isn't reachable, report "queued until the next turn" in `outlook` and fall back to hooks.

### Cursor
- MCP server in `~/.cursor/mcp.json` (user level); use MCP roots to learn the open folder.
- Hooks in `~/.cursor/hooks.json` (merge). On `sessionStart`, register the agent and return context
  that tells the agent to start **one Cursor-owned background shell task** running
  `mcp-parley inbox watch --agent <id> --once`. That command waits silently, prints one message and
  exits, and its completion resumes the agent. The agent then answers and starts a new watch.
- On `stop`, drain queued messages through Cursor's `followup_message`.
- Cursor and Grok are the two adapters that need a little instruction text, because the agent itself
  starts its watcher. Deliver it through hook output, never through a rules file in the repo.

### Grok Build
- MCP server and a Grok plugin (Grok's plugin format resembles Claude Code's) with `SessionStart`,
  `PostToolUse` and `Stop` hooks.
- Idle wake: Grok's persistent `monitor` tool running
  `mcp-parley inbox watch --agent <id> --provider grok`. The agent has to start it itself, and the
  monitor doesn't get the session id, so pass `--agent` explicitly. If a turn ends with no monitor
  running, the `Stop` hook keeps the turn open **once** and gives the agent the exact command.
- "Grok Bot" on grok.com (the hosted agent) can't run local hooks. It is out of scope for v1; note
  it as future work for cross-machine support.

### Recorded-session tests
For each adapter, capture real hook payloads and outputs into `fixtures/` during the human-assisted
tests, with paths and ids anonymised. Unit tests replay them. A fixture may never contain secrets or
personal data.

## 7. CLI

```
mcp-parley setup [--harness <name>] [--dry-run]   detect harnesses, install adapters, print the first sentence to try
mcp-parley uninstall                             remove exactly what setup added
mcp-parley serve                                 the MCP server (stdio), started by harnesses
mcp-parley who                                   agents in this repo, alive or idle
mcp-parley log [--thread <id>]                   print a conversation
mcp-parley export --format md|jsonl              export this repo's conversations and decisions
mcp-parley viewer [--port N]                     start the viewer and open the browser
mcp-parley doctor                                per-harness: installed? hooks trusted? can wake idle?
mcp-parley inbox drain|watch|register ...        used by adapters
mcp-parley hook <event>                          used by adapters
```
`setup` prints exactly which files it changed. `--dry-run` changes nothing.

## 8. Viewer

- `node:http` server bound to `127.0.0.1` only, on a random free port unless `--port` is given. A
  random token in the URL protects it from other local pages; reject requests without it.
- Server-Sent Events push new messages, receipts and agreement changes.
- Screens: an agent list with alive or idle state; a thread list with title, last message, receipt,
  ≈tokens and status; a thread view with messages, receipts, agreements (with a **Veto** button), a
  text box to post as `you`, and **Pause/Resume**; a global **Stop all** switch; Export buttons.
- Plain TypeScript bundled with esbuild into one JS file, plus CSS. Light and dark mode. It must work
  at 375 px width.

## 9. Notifications

`notify/os-notify.ts`: macOS uses `osascript -e 'display notification …'`, Linux uses `notify-send`
when present, Windows does nothing in v1. Notify for: accepted agreements, conflicts, paused threads.
Never include message content beyond a 60-character preview.

## 10. Milestones

Each milestone lists its acceptance checks. **(H)** marks steps that need the human.

**M0. Scaffold.** The git repo already exists (private, `github.com/inanc-can/parley-mcp`, branch `main`). Add pnpm, TypeScript strict, ESLint strict type-checked (no-explicit-any,
no-unsafe-*, consistent-type-assertions: never, max-lines 400), Prettier, Vitest; a `pnpm check`
script; a GitHub Actions CI file for Node 20 and 22 on macOS, Linux and Windows; MIT LICENSE; empty
`docs/PROGRESS.md` and `docs/harness-notes.md`.
*Check:* `pnpm check` passes on an empty test suite; an `any` in a scratch file fails lint.
*(H) Then stop:* the human sets up the agent workbench with `pnpm check` as its verify gate before M1
starts. Don't create `.workbench/` yourself.

**M1. Store and core.** Schema, migrations, repositories with Zod row parsing; identity, message state
machine, threads, agreements, claims, overlap, guards (cap, stop-all, secret scan), retention, cost
estimate.
*Check:* unit tests cover every status move (including guarded no-ops, requeue and expiry),
idempotent sends, `everyone` fan-out, cap → paused, secret blocking for each pattern, claim expiry,
overlap detection, and 30-day retention.

**M2. MCP server.** `serve` with `talk`, `inbox` and `agree`, using the official SDK over stdio.
*Check:* integration tests with the SDK's in-memory transport: two fake agents exchange messages,
receipts move correctly, an agreement is offered and accepted, the token size of the three tool
definitions is measured and printed (must be under 1,500).

**M3. CLI basics.** `who`, `log`, `export`, `inbox drain|watch|register`, `hook edit`, and `setup` /
`uninstall` / `doctor` frameworks with a fake adapter.
*Check:* `setup --dry-run` against a temporary HOME lists the changes; running `setup` twice changes
nothing the second time; `uninstall` restores the files byte for byte.

**Work harness first.** The human is adding the harness they use at work as a fifth launch harness
and wants its adapter built **first**, before M4. When `docs/harness-notes.md` names it, build its adapter
as M3b using the same `Adapter` interface and the same acceptance check as M4 (idle session answers
within 5 s, fixtures, replay tests). Until it is named, continue with M4.

**M4. Claude Code adapter.** Plugin, monitor, hooks and install.
*Check (H):* the human opens two Claude Code sessions in two folders of one repo, types
`say hi to claude@<other>`, and the idle session answers within 5 s with no typing. Read receipts
appear. Capture fixtures, then write replay tests.

**M5. Codex adapter.** Config, hooks, app-server wake with fallback.
*Check (H):* Claude Code ↔ Codex round trip with Codex idle. `doctor` correctly reports when hooks are
untrusted. Fixtures and replay tests.

**M6. Viewer.** As in section 8, including posting as `you`, pause, stop-all and veto.
*Check:* an automated test drives the viewer API (post, pause, veto, SSE events);
*(H)* the human watches a live Claude ↔ Codex thread update without reloading.

**M7. Notifications, rules file, loop guard end to end.**
*Check:* a scripted conversation hits the cap, pauses, and triggers a notification; a message
containing a fake `ghp_…` token is blocked; the rules reminder appears when `.parley/rules.md` exists.

**M8. Cursor adapter.** *Check (H):* Cursor ↔ Claude Code round trip with Cursor idle; fixtures.

**M9. Grok Build adapter.** *Check (H):* Grok ↔ Claude Code round trip with Grok idle; the Stop-hook
reminder fires once when no monitor runs; fixtures.

**M10. Claims and overlap from real edits.** Edit hooks for all four harnesses.
*Check (H):* two agents edit the same file; both get a warning thread within 5 s and the human gets a
notification.

**M11. Telemetry: deliberately not built.** The decision is opt-in anonymous counts, but sending counts
needs a server, and the project has no hosted service. Add only a `settings.telemetry_opt_in` flag
(default false) and a doc stub. **Stop and ask the human** before writing any sending code.

**M12. Launch polish.** README with a 30-second demo GIF at the top (the human records it) and a
tagline that names the four harnesses; a one-command install; `docs/adding-a-harness.md`; 10
"good first issue" drafts (for example adapters for Gemini CLI, OpenCode, Copilot CLI, Goose);
CHANGELOG; version 0.1.0.
*(H):* the human publishes as `mcp-parley` (chosen 2026-11-07; re-check it is still free first).

## 11. Done when

- A new user goes from `npx mcp-parley setup` to two agents greeting each other in under 2 minutes.
- A message to an idle agent on each of the four harnesses is delivered within 5 seconds.
- Two agents reach an accepted agreement, and the human sees it and can veto it in the viewer.
- Two agents editing the same file are both warned.
- Nothing is written into the repository during setup; `uninstall` leaves no trace.
- `pnpm check` passes on CI for macOS and Linux. (Changed by the human, 2026-11-10: v0.1.0 is macOS and Linux only; Windows support is a later issue.)
