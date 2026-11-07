# Progress

## M2 — Results (completed 2026-11-07)

**Built**
- `src/mcp/server.ts` — `createServer(ctx)` wires talk/inbox/agree to an `McpServer`; `serve()` opens the hub db (~/.parley-mcp/hub.db), runs retention, registers the agent, connects `StdioServerTransport`. Only file importing the SDK.
- `src/mcp/identity.ts` — `resolveAgentId` (PARLEY_AGENT_ID / PARLEY_HARNESS / cwd fallback), `registerCaller` (upsert), `heartbeatCaller`.
- `src/mcp/guards.ts` — `enforceMessageCap` and `checkStopAllActive` compositions moved here from `src/store` (follow-up a).
- `src/mcp/context.ts` — `ToolContext` (db, agentId, repoRoot, nativeSession, rulesTextSent).
- `src/mcp/response.ts` — `ToolOutcome`, `success`, `refused`, `toToolResult` (structuredContent + text summary per PLAN §5).
- `src/mcp/rules.ts` — `readRulesFile` / `rulesReminder` for `.parley/rules.md`.
- `src/mcp/outlook.ts` — `buildOutlook` / `pluralOutlook` from recipient heartbeat presence.
- `src/mcp/tools/talk.ts` — stop-all, secret scan, self-message, thread resolve/create, postable check, idempotent send + everyone fan-out, sent events, reply marking, cap enforcement, wait_for_reply_s polling, structured result + summary.
- `src/mcp/tools/inbox.ts` — deliver+read marking with events, sent receipts, accepted decisions, who (alive/idle), rules reminder + once-per-session text.
- `src/mcp/tools/agree.ts` — offer/accept/counter/reject via guarded store update; claim/renew/release with overlap conflict warnings.
- `src/core/identity.ts` — added `isAlive` (30 s heartbeat window).
- `src/core/message-rules.ts` — added `MESSAGE_TTL_MS` (24 h).
- `src/core/threads.ts` — added `titleFromFirstMessage`, `MAX_TITLE_LENGTH`.
- `src/core/overlap.ts` — added `claimsOverlap`.
- `src/store/schema.ts` — extracted `MESSAGE_KINDS` + `messageKindSchema`.
- `src/store/repos/messages-repo.ts` — added `listMessagesFromAgent`, `findLatestReplyTo`.
- `src/store/repos/agreements-repo.ts` — `updateAgreementStatus` guarded (only `offered`, only recipient thread participant), returns boolean (follow-up b).
- Tests: `test/mcp/integration.test.ts` (SDK InMemoryTransport, two agents, message round-trip + receipt moves + offer/accept), `test/mcp/tool-size.test.ts` (~518 tokens, under 1,500), `test/mcp/guards.test.ts` (moved compositions), `test/store/layering.test.ts` (store never imports core, mutation-verified), `test/store/agreements.test.ts` (forbidden update attempts), `test/core/guards.test.ts` (near-miss AKIA/xoxb/env values) (follow-up c), `test/core/identity.test.ts` (isAlive), `test/core/fanout-and-cap.test.ts` (titleFromFirstMessage).

**Commands/results (via `wb run -- ...`)**
- `pnpm add @modelcontextprotocol/sdk` → v1.32.2 (PLAN-allowed runtime dep, `new-dependency` approval in scope.json).
- `pnpm check` (eslint + tsc --noEmit + vitest): **passed** — 18 test files, 67 tests passed.
- `wb verify`: **PASS** (all acceptance commands exit 0).

**Commits (local, not pushed)**
- `docs: frame M2 MCP server workbench task`
- `chore: add @modelcontextprotocol/sdk runtime dependency`
- `fix: guard agreement answers, move guard compositions to the mcp layer, and add near-miss secret tests`
- `feat: add MCP server with talk/inbox/agree over stdio`

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
