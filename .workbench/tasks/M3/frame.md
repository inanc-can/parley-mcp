# M3 — CLI basics

## Goal

Implement PLAN.md section 7 / milestone M3: the `parley-mcp` CLI (commander) with the
basic commands — `serve` (wire the M2 MCP server), `who`, `log`, `export`,
`inbox drain|watch|register`, `hook edit`, and the `setup` / `uninstall` / `doctor`
frameworks driven by a fake adapter and the `Adapter` interface (PLAN section 6).
Fold in the four M2 review follow-ups listed in state.json `next_action`.

## Facts (with receipts)

- CLI surface is PLAN.md section 7 (read 2026-11-07). `setup --dry-run` changes nothing and
  lists the files it would change; running `setup` twice is idempotent; `uninstall` restores
  files byte for byte — the M3 acceptance checks.
- The `Adapter` interface is PLAN.md section 6: `harness`, `detect()`, `install()`,
  `uninstall()`, `doctor()`. M3 ships a **fake adapter** only; real harness adapters are M4+.
- `serve()` already exists in `src/mcp/server.ts` (M2). M3 adds the `parley-mcp serve` CLI
  wiring. state.json records that the serve command wiring was deferred from M2 to M3.
- `commander` is on PLAN.md's allowed runtime dependency list (section 3). No other new deps.
- The layer rule (AGENTS.md): `cli` → `core` → `store`; `cli` may also use `mcp`. `core` is
  pure, no I/O. Repo-root (git top-level) resolution is I/O and belongs outside `core`.
- Store/core/mcp repos and helpers that CLI reuses: `src/store/index.ts` (repos),
  `src/core/identity.ts` (isAlive), `src/core/cost.ts`, `src/mcp/server.ts` (serve),
  `src/mcp/rules.ts`. Search for an existing helper before adding one (AGENTS.md).
- Existing tests all pass (M2: 87 tests, `wb verify` PASS).

## M2 review follow-ups to fold in (state.json next_action)

1. **serve() close handling** — set the close handler _before_ `server.connect` (don't replace
   the SDK's own `transport.onclose`); also close the db on stdin `end`/`close`; add a test of
   the close path; fix the misleading comment.
2. **recipient-guard test** — a third agent that is a _thread participant_ but not the agreement
   recipient is refused (extends the existing agreement guard coverage).
3. **offered_to nullable vs required** — migration 2 adds `offered_to TEXT` (nullable) but the
   Zod row schema requires it. Pre-release, no production rows exist: fold `offered_to TEXT NOT
NULL` into the initial schema (migration 1) and drop the separate nullable migration, so the
   SQL column and the Zod schema agree. Record this as an assumption.
4. **tidy** — remove the trailing blank lines in `src/core/overlap.ts`; fix the serve test's
   leaked db handle (close `checkDb`/streams deterministically).

## Allowed / forbidden paths

Allowed: `src/cli/**`, `src/adapters/**`, `src/mcp/**`, `src/store/**`, `src/core/**`,
`test/**`, `package.json`, `pnpm-lock.yaml`, `docs/**`, `.workbench/**`.
Forbidden: `src/viewer/**`, `src/notify/**` (later milestones), and the global forbidden
list (secrets, `.git/**`).

## Acceptance

- `pnpm check` (lint + typecheck + vitest) passes.
- A test runs `setup --dry-run` against a temporary HOME and asserts it lists the changes and
  writes nothing.
- A test runs `setup` twice against a temporary HOME and asserts the second run changes nothing.
- A test asserts `uninstall` restores the files byte for byte (removes exactly what setup added).
- Tests for `who`, `log`, `export` (md + jsonl), `inbox drain|watch|register`, `hook edit`.
- A test of the serve() close path (db closed on transport/stdin close).
- `wb verify` passes.

## Unknowns

- discoverable: commander's ESM API shape — resolve by reading installed types.
- decidable: exact JSON shape the fake adapter's `install()` writes (a small user-level file
  under a temp HOME); the CLI output format for `who`/`log`/`export`. Builder's choice, tested.
- human: none expected. The real harness adapters, npm name and publishing stay with the human
  (M4+/M12). No network, no repo writes.
- deferred: `viewer` command does real work in M6; M3 only needs a stub that errors cleanly or
  is omitted. PLAN lists `viewer` in section 7 but its behaviour is M6 — M3 provides a
  placeholder that says it arrives in M6.
