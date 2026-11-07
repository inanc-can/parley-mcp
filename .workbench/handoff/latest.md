# Handoff 2026-11-07T15:22:45+00:00

- Task: M2
- HEAD: `62982df72ea6`
- Verification: PASS `.workbench/tasks/M2/verification.json`
- Review: `.workbench/tasks/M2/review.json`

- Mode: checkpoints

## Summary
M2 (MCP server: talk/inbox/agree over stdio, plus the three M1 follow-ups) built by OpenCode (GLM, then Nemotron free). wb verify for task M2 passes: 67 tests, every acceptance command. Independent review round 1 is running.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)

## Next action
When the reviewer reports: save .workbench/tasks/M2/review.json; on soft_fail have OpenCode fix the findings, re-verify and re-review (at most 2 rounds); on pass close M2 and run wb handoff. Pushing to GitHub is a blocker for the human (outward action).

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
- `src/store/repos/agreements-repo.ts`
- `src/store/repos/messages-repo.ts`
- `src/store/repos/settings-repo.ts`
- `src/store/repos/threads-repo.ts`
- `src/store/schema.ts`
- `test/core/fanout-and-cap.test.ts`
- `test/core/guards.test.ts`
- `test/core/identity.test.ts`
- `test/mcp/guards.test.ts`
- `test/mcp/integration.test.ts`
- `test/mcp/tool-size.test.ts`
- `test/store/agreements.test.ts`
- `test/store/layering.test.ts`
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
- `pnpm check` exit 0 (13821ms)
- `sh -c printf "import { x } from \"../../core/threads.js\";\n" >> src/store/parse.ts && pnpm exec vitest run test/store/layering.test.ts; echo mutation-exit=$?; git checkout -- src/store/parse.ts; pnpm exec vitest run test/store/layering.test.ts; echo restored-exit=$?` exit 0 (5181ms)
- `sh -c printf "import { x } from \"../../core/threads.js\";\n" >> src/store/parse.ts && pnpm exec vitest run test/store/layering.test.ts; echo mutation-exit=$?; git checkout -- src/store/parse.ts; pnpm exec vitest run test/store/layering.test.ts; echo restored-exit=$?` exit 0 (7084ms)
- `pnpm check` exit 0 (14202ms)
- `pnpm check` exit 1 (7116ms)
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
