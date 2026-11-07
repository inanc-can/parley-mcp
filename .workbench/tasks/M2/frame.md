# M2 — MCP server (talk/inbox/agree over stdio)

## Goal
Implement PLAN.md milestone M2: the MCP `serve` command with `talk`, `inbox` and `agree`, using the official `@modelcontextprotocol/sdk` over stdio, plus the three M1 review follow-ups recorded in `.workbench/state.json` `next_action`.

## Facts (with receipts)
- PLAN.md §5 defines the three tools, their exact schemas and the 1,500-token budget (receipt: `docs/PLAN.md`).
- M1 store + core are complete; `wb verify` round 2 passes with 55 tests (receipt: `docs/PROGRESS.md`, `.workbench/tasks/M1/verification.json`).
- Store currently imports core in `src/store/repos/threads-repo.ts` (`shouldPauseAfterCount`) and `src/store/repos/settings-repo.ts` (`checkStopAll`) — the M1 review follow-up (a) inversion to fix (receipt: those files).
- `agreementsRepo.updateAgreementStatus` is currently unguarded: any caller can move any row to any status (receipt: `src/store/repos/agreements-repo.ts`).
- Secret patterns have length minima that near-misses must not trigger (receipt: `src/core/guards.ts`).
- `@modelcontextprotocol/sdk` is on PLAN's allowed runtime dependency list (receipt: `docs/PLAN.md` §3); recorded as `new-dependency` approval in scope.json.

## Allowed files
- `src/mcp/**`, `src/store/**`, `src/core/**` (core only if a follow-up requires a pure helper)
- `test/mcp/**`, `test/store/**`, `test/core/**`
- `docs/PROGRESS.md`, `docs/harness-notes.md`
- `package.json`, `pnpm-lock.yaml`
- `.workbench/**`

## Forbidden files
- `src/cli/**`, `src/adapters/**`, `src/viewer/**`, `src/notify/**` (later milestones)
- Anything in `.workbench/config.json` forbidden list

## Acceptance (M2, from PLAN.md + state.json next_action)
- Integration tests with the SDK's in-memory transport: two fake agents exchange messages, receipts move correctly, an agreement is offered and accepted.
- A test measures and prints the token size of the three tool definitions and fails above 1,500.
- Follow-up (a): store never imports core logic (cap→pause and stop-all compositions live in `src/mcp/guards.ts`).
- Follow-up (b): `updateAgreementStatus` refuses non-`offered` rows and non-recipients; a store test attempts the forbidden update.
- Follow-up (c): near-miss secret-scan tests (short env values, too-short AKIA, too-short xoxb) pass.
- `pnpm check` and `wb verify` pass.

## Unknowns
- discoverable: exact `@modelcontextprotocol/sdk` API surface for the installed version (tool registration, `structuredContent`, `InMemoryTransport`) — resolve from the installed package's d.ts during build; recorded in harness-notes.
- discoverable: token estimate method — PLAN gives only "under 1,500 tokens"; using the project's own chars/4 estimate over the serialized tool definitions, printed by the test.
- decidable (recorded in PROGRESS/state when chosen): identity source for M2 (env `PARLEY_AGENT_ID`, adapters replace it in M4+), agreement recipient derivation (thread participant ≠ offerer), counter = mark original `countered` + new `offered` child row, claim renew/release keyed by caller + path_glob.
- human: none for M2 scope. Dependency `@modelcontextprotocol/sdk` is pre-approved by PLAN.md §3.
- deferred: real harness wake/delivery (M3b/M4+), viewer veto (M6), notifications (M7/M9), rules-file end-to-end check (M7; the one-line reminder + once-per-session rules text is included here because it is part of `talk`/`inbox` behavior).
