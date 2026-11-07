# M1 — Store and core

## Goal
Implement PLAN.md milestone M1: SQLite store (schema, migrations, repositories with Zod row parsing) and pure core logic (identity, message state machine, threads, agreements, claims, overlap, guards/cap/stop-all/secret scan, retention, cost estimate).

## Facts (with receipts)
- PLAN.md §4, §10 M1 define the data model and required behaviors (receipt: `docs/PLAN.md`).
- M0 scaffold complete; `pnpm check` passes (receipt: `docs/PROGRESS.md`).
- Runtime deps allowed by PLAN: `better-sqlite3`, `zod`; dev: `@types/better-sqlite3`, `@types/node` present (receipt: `docs/PLAN.md` §3).

## Allowed files
- `src/store/**`, `src/core/**`
- `test/store/**`, `test/core/**`
- `docs/PROGRESS.md`, `docs/harness-notes.md`
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `.workbench/**`

## Forbidden files
- `src/mcp/**`, `src/cli/**`, `src/adapters/**`, `src/viewer/**`, `src/notify/**` (later milestones)
- Anything in `.workbench/config.json` forbidden list

## Acceptance (M1, from PLAN.md)
- Unit tests cover every status move (including guarded no-ops, requeue and expiry), idempotent sends, `everyone` fan-out, cap → paused, secret blocking for each pattern, claim expiry, overlap detection, and 30-day retention.
- `pnpm check` passes (lint + typecheck + test), including strict rules (no `any`, no `as` assertions except `as const`, max-lines 400).

## Unknowns
- discoverable: exact SQLite busy-timeout/WAL defaults and better-sqlite3 typing patterns (resolve from code/docs during build).
- human: none for M1 scope. Dependencies (`better-sqlite3`, `zod`, `@types/better-sqlite3`) are pre-approved by PLAN.md; recorded in scope approvals.
- deferred: real harness session-id mapping details (M4+; record in harness-notes when verified).
