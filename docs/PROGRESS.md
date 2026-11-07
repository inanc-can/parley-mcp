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

---

## M0 — Scaffold (plan, 2026-11-07)

**Goal:** Set up the repository tooling so `pnpm check` (lint + typecheck + test) passes and CI enforces it, with strict TypeScript/ESLint rules required by `AGENTS.md`.

**Tasks**
1. Create `docs/PROGRESS.md` (this file) with the M0 plan and `docs/harness-notes.md` (empty stub).
2. Initialize `package.json` (pnpm, Node >=20, `"type": "module"`), `tsconfig.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), and a minimal `src/` placeholder so typecheck has input.
3. Configure ESLint (strict type-checked) with `@typescript-eslint/no-explicit-any` error, `no-unsafe-*` rules, `consistent-type-assertions: never` (allow `as const` only where supported), and `max-lines` 400; configure Prettier.
4. Configure Vitest with an empty passing test placeholder (so `pnpm check` passes on an empty suite). Add `pnpm check` script (lint + typecheck + test).
5. Add GitHub Actions CI for Node 20 and 22 on macOS, Linux, and Windows running `pnpm check`.
6. Add MIT `LICENSE`.
7. Verify acceptance: `pnpm check` passes; an `any` in a scratch file fails lint. Record results here and stop (human sets up workbench).

**Constraints/notes**
- No files over 400 lines, no `any`, no `as` assertions except `as const`. CI will enforce ESLint rules.
- `opencode.json` is read-only in this environment; shell permissions are allowlisted (I cannot `git push`, publish, or run denied commands). If blocked, I will record it here.
- `git` operations were occasionally contended by an `.git/index.lock` during parallel tool calls; resolved by retrying sequentially. Avoid parallel `git` commands in this environment.

## M0 — Results (completed 2026-11-07)

**Built**
- `package.json` (pnpm, Node >=20, ESM, `pnpm check` = lint + typecheck + test), `pnpm-lock.yaml`, `pnpm-workspace.yaml`/`.npmrc` for pnpm build approvals.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (plus `noImplicitOverride`, `noPropertyAccessFromIndexSignature`).
- `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` strict/stylistic type-checked; enforces `@typescript-eslint/no-explicit-any`, `no-unsafe-*`, `consistent-type-assertions: never`, `max-lines: 400`.
- `prettier.config.js`, `.prettierignore`, `vitest.config.ts`, placeholder `src/index.ts` and `test/smoke.test.ts`.
- `.github/workflows/ci.yml`: Node 20/22 on `ubuntu-latest`, `macos-latest`, `windows-latest` running `pnpm install --frozen-lockfile` + `pnpm check`.
- `LICENSE` (MIT), `docs/harness-notes.md` (stub).

**Commands/results**
- `pnpm install` (required build-approval config for esbuild in pnpm 11); `pnpm approve-builds --all` completed esbuild postinstall.
- `pnpm check` (runs `eslint . && tsc --noEmit && vitest run`): **passed** — 1 test file, 1 test passed.
- Acceptance (any fails lint): created `test/scratch-any.ts` with `export const bad: any = 1;` → `npx eslint test/scratch-any.ts` reported `@typescript-eslint/no-explicit-any` error; scratch file removed and `pnpm check` still passes.

**Commits (local, not pushed)**
- `docs: add M0 plan and harness notes stub`
- `chore: scaffold package, TypeScript, ESLint, Prettier, and Vitest`
- `chore: add GitHub Actions CI matrix`
- `chore: add MIT license`
- (this update) records M0 completion.

**Next (human)**
- Set up the agent workbench with `pnpm check` as its verify gate before M1 starts (do not create `.workbench/` here). M3b/M4 harness work remains blocked until the work harness is named / human-assisted tests run as specified in PLAN.

---
