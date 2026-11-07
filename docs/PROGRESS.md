# Progress

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
- (pending) records M1 results + workbench handoff.

**Notes/decisions**
- Guarded message transitions are enforced by the store using the valid state machine (`sent→delivered→read→replied`, `sent→failed`) as guarded `UPDATE … WHERE status IN (...)` no-ops.
- Retention deletion runs in FK-safe order (events before messages).
- `better-sqlite3` required native build approval in pnpm 11 (`pnpm-workspace.yaml` `onlyBuiltDependencies`).

**Next (per PLAN)**
- M2: MCP server (`serve`) with `talk`, `inbox`, `agree` over stdio (official SDK). Note PLAN’s work-harness-first instruction: build M3b when the work harness is named, before M4; M2/M3 follow in order.

---
