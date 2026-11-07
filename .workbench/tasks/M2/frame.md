# M2 fix — review round 1 soft_fail findings

## Goal
Fix every finding in `.workbench/tasks/M2/review.json` (soft_fail, 5/10) without touching `src/cli` (forbidden in M2), then re-verify (`pnpm check` + `wb verify`) and hand off.

## Facts (with receipts)
- Review finding 1 (high): `serve()` closes `db` in `finally` right after `server.connect(transport)`. stdio `start()` returns immediately, so real stdio tool calls hit a closed db. Fix: keep db open until transport close (`transport.onclose`); add a test driving `serve()` over a stream pair and making a real tool call. Receipt: `src/mcp/server.ts:76-95`.
- Review finding 2 (medium): agreement recipient never stored; guard allows any non-offerer participant, so a third agent can answer an offer made to another. Fix: store `offered_to` and guard on it; 3-agent test where a third agent's accept is refused. Receipt: `src/store/repos/agreements-repo.ts:44-70`.
- Review finding 3 (medium): `counter` marks the original countered before checking text; a counter without text orphans the original. Fix: validate text first, do both writes in one transaction. Receipt: `src/mcp/tools/agree.ts:111-170`.
- Review finding 4 (medium): integration test stops at read; no reply→replied assertion, no forbidden answer through MCP, no `structuredContent` assertion; missing unit tests for outlook, secret blocking, rules reminder and claim conflicts. Receipt: `test/mcp/integration.test.ts`.
- Review finding 5 (low): `agree claim` counts the caller's own claims as conflicts (PLAN 4.5: other agents). Remove `claimsOverlap` alias, remove no-op JOIN in `listMessagesFromAgent`, move `titleFromFirstMessage` test into a threads test file. Receipt: `src/mcp/tools/agree.ts:206-236`, `src/core/overlap.ts:62`, `src/store/repos/messages-repo.ts:212-222`, `test/core/fanout-and-cap.test.ts:85-93`.
- Allowed files (scope.json): `src/mcp/**`, `src/store/**`, `src/core/**`, `test/mcp/**`, `test/store/**`, `test/core/**`, `docs/PROGRESS.md`, `docs/harness-notes.md`, `package.json`, `pnpm-lock.yaml`, `.workbench/**`.
- Forbidden: `src/cli/**` (the `serve` command wiring is deferred to M3; record as an assumption in state.json).

## Acceptance
- `pnpm check` (lint + typecheck + full test suite) passes.
- `wb verify` passes for M2.
- Every review finding fixed with a test that would fail on the pre-fix code.

## Unknowns
- discoverable: none remaining; the installed SDK (`1.32.2`) `StdioServerTransport` accepts injected `stdin`/`stdout` streams (receipt: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.d.ts`).
- assumption to record in state.json: the `serve` command itself is wired in M3 (`src/cli`); M2 only owns `src/mcp/server.ts#serve`.
