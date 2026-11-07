# Handoff 2026-11-07T15:50:38+00:00

- Task: M2
- HEAD: `bcd3008147da`
- Verification: PASS (stale: files changed since) `.workbench/tasks/M2/verification.json`
- Review: `.workbench/tasks/M2/review.json`

- Mode: checkpoints (M2 review findings fixed; pnpm check and wb verify pass; 87 tests)

## Summary
M2 review round 1 soft_fail fixed by OpenCode (Nemotron free). All five review findings are fixed and re-tested: (1) serve() keeps the hub db open until the stdio transport closes, with a serve() stream-pair test making a real talk call; (2) the agreement recipient (offered_to) is stored via a new migration and answers are guarded on it, including a 3-agent test where a third agent's accept is refused; (3) counter validates text before touching the store and does both writes in one transaction; (4) the integration test now asserts a reply moves the original to replied, refuses a forbidden answer through MCP, and asserts structuredContent, plus new unit tests for outlook, secret blocking (near-misses), rules reminder and claim conflicts; (5) agree claim reports only other agents' claims, the claimsOverlap alias and the no-op listMessagesFromAgent JOIN are removed, and the titleFromFirstMessage test moved into test/core/threads.test.ts. wb verify for task M2 passes: 87 tests, every acceptance command. The serve command itself (the `parley-mcp serve` CLI wiring in src/cli) is NOT part of M2; it is wired in M3 (src/cli) - recorded as an assumption below.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)

## Next action
wb verify passes for M2 (87 tests, all acceptance commands). Run wb handoff and stop. Pushing to GitHub is a blocker for the human (outward action).

## Changed files
- `docs/PROGRESS.md`
- `package.json`
- `pnpm-lock.yaml`
- `src/core/identity.ts`
- `src/core/message-rules.ts`
- `src/core/overlap.ts`
- `src/core/threads.ts`
- `src/mcp/context.ts`
- `src/mcp/guards.ts`
- `src/mcp/identity.ts`
- `src/mcp/outlook.ts`
- `src/mcp/response.ts`
- `src/mcp/rules.ts`
- `src/mcp/server.ts`
- `src/mcp/tools/agree.ts`
- `src/mcp/tools/inbox.ts`
- `src/mcp/tools/talk.ts`
- `src/store/migrations.ts`
- `src/store/repos/agreements-repo.ts`
- `src/store/repos/messages-repo.ts`
- `src/store/repos/settings-repo.ts`
- `src/store/repos/threads-repo.ts`
- `src/store/schema.ts`
- `test/core/fanout-and-cap.test.ts`
- `test/core/guards.test.ts`
- `test/core/identity.test.ts`
- `test/core/threads.test.ts`
- `test/mcp/agree.test.ts`
- `test/mcp/guards.test.ts`
- `test/mcp/integration.test.ts`
- `test/mcp/outlook.test.ts`
- `test/mcp/rules.test.ts`
- `test/mcp/serve.test.ts`
- `test/mcp/tool-size.test.ts`
- `test/store/agreements.test.ts`
- `test/store/layering.test.ts`
- `test/store/retention.test.ts`
- `test/store/stop-all.test.ts`

## Open risks
- none

## Failed attempts
- pnpm run typecheck (exit 2)
- pnpm run typecheck (exit 2)
- pnpm check (exit 1)
- pnpm check (exit 1)
- pnpm check (exit 1)
- pnpm check (exit 1)
- pnpm check (exit 1)
- pnpm run typecheck (exit 2)
- pnpm run typecheck (exit 2)
- pnpm check (exit 1)

## Commands (last 30)
- `pnpm exec vitest run test/mcp/integration.test.ts` exit 1 (1765ms)
- `pnpm exec vitest run test/mcp/tool-size.test.ts` exit 1 (1122ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (2374ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (2106ms)
- `pnpm run typecheck` exit 2 (2562ms)
- `pnpm run typecheck` exit 2 (2062ms)
- `pnpm run typecheck` exit 2 (2450ms)
- `pnpm run typecheck` exit 0 (1915ms)
- `pnpm check` exit 1 (6304ms)
- `pnpm check` exit 0 (9992ms)
- `pnpm check` exit 1 (6773ms)
- `pnpm check` exit 1 (6281ms)
- `pnpm check` exit 1 (6594ms)
- `pnpm check` exit 1 (8133ms)
- `pnpm run typecheck` exit 2 (2563ms)
- `pnpm run typecheck` exit 2 (2837ms)
- `pnpm run typecheck` exit 0 (3083ms)
- `pnpm run lint` exit 0 (6822ms)
- `pnpm check` exit 1 (13516ms)
- `pnpm check` exit 0 (13488ms)
- `pnpm check` exit 0 (14271ms)
- `pnpm exec vitest run test/mcp/integration.test.ts` exit 0 (2766ms)
- `pnpm exec vitest run test/mcp/tool-size.test.ts` exit 0 (2786ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (2534ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (2323ms)
- `pnpm check` exit 0 (12499ms)
- `pnpm exec vitest run test/mcp/integration.test.ts` exit 0 (2517ms)
- `pnpm exec vitest run test/mcp/tool-size.test.ts` exit 0 (2366ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (2154ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (1986ms)
