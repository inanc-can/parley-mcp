# Handoff 2026-11-07T14:09:22+00:00

- Task: M1
- HEAD: `12044657a852`
- Verification: PASS `.workbench/tasks/M1/verification.json`
- Review: `.workbench/tasks/M1/review.json`

- Mode: checkpoints (checkpoints mode recorded for session opencode-M1-fix (wb mode checkpoints); stop at end of milestone reached: wb verify PASS, handoff done.)

## Summary
M1 clear: all 7 acceptance commands and pnpm check pass (55 tests), wb verify PASS (round 2). Independent review round 1 (soft_fail) addressed: retention FK-safe with old-message/newer-event test, enforceMessageCap composes count+cap+pause with mutation-checked test asserting DEFAULT_MESSAGE_CAP=20, real stop-all guard with tests, agreement lifecycle tests, delivered->replied stamps read_at per PLAN 4.3, assumptions recorded, pnpm-workspace.yaml change explained in docs/PROGRESS.md.

## Decisions made without asking (review these)
- none

## Next action
Run the independent reviewer on the review-fixes commits (a94c981..719bd91 + docs). If it passes, start M2 (MCP server `serve` with `talk`, `inbox`, `agree` over stdio); also confirm the opencode.json human_approved_exceptions entry captured on the user's spoken request. All M1 work is committed; nothing to push (never push).

## Changed files
- `docs/PROGRESS.md`
- `opencode.json`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/core/agreements.ts`
- `src/core/claims.ts`
- `src/core/cost.ts`
- `src/core/glob.ts`
- `src/core/guards.ts`
- `src/core/identity.ts`
- `src/core/message-rules.ts`
- `src/core/overlap.ts`
- `src/core/retention.ts`
- `src/core/threads.ts`
- `src/store/db.ts`
- `src/store/index.ts`
- `src/store/migrations.ts`
- `src/store/parse.ts`
- `src/store/repos/agents-repo.ts`
- `src/store/repos/agreements-repo.ts`
- `src/store/repos/claims-repo.ts`
- `src/store/repos/edits-repo.ts`
- `src/store/repos/message-events-repo.ts`
- `src/store/repos/messages-repo.ts`
- `src/store/repos/settings-repo.ts`
- `src/store/repos/threads-repo.ts`
- `src/store/retention.ts`
- `src/store/schema.ts`
- `test/core/agreements.test.ts`
- `test/core/claims.test.ts`
- `test/core/cost.test.ts`
- `test/core/fanout-and-cap.test.ts`
- `test/core/guards.test.ts`
- `test/core/identity.test.ts`
- `test/core/overlap.test.ts`
- `test/store/agreements.test.ts`
- `test/store/claims.test.ts`
- `test/store/db.test.ts`
- `test/store/messages.test.ts`
- `test/store/retention.test.ts`
- `test/store/stop-all.test.ts`

## Open risks
- none

## Failed attempts
- pnpm exec vitest run test/store/retention.test.ts test/core/fanout-and-cap.test.ts test/core/guards.test.ts test/store/stop-all.test.ts test/core/agreements.test.ts test/store/agreements.test.ts test/store/messages.test.ts (exit 1)
- pnpm exec vitest run test/store/stop-all.test.ts (exit 1)
- pnpm exec vitest run test/core/fanout-and-cap.test.ts (exit 1)
- pnpm exec vitest run test/core/fanout-and-cap.test.ts (exit 1)

## Commands (last 30)
- `pnpm exec vitest run test/core/overlap.test.ts` exit 0 (2880ms)
- `pnpm exec vitest run test/store/retention.test.ts` exit 0 (3146ms)
- `pnpm check` exit 0 (12198ms)
- `pnpm exec vitest run test/store/messages.test.ts` exit 0 (2525ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts` exit 0 (2818ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (2588ms)
- `pnpm exec vitest run test/core/claims.test.ts test/store/claims.test.ts` exit 0 (2923ms)
- `pnpm exec vitest run test/core/overlap.test.ts` exit 0 (2745ms)
- `pnpm exec vitest run test/store/retention.test.ts` exit 0 (3301ms)
- `pnpm exec vitest run test/store/retention.test.ts test/core/fanout-and-cap.test.ts test/core/guards.test.ts test/store/stop-all.test.ts test/core/agreements.test.ts test/store/agreements.test.ts test/store/messages.test.ts` exit 1 (3220ms)
- `pnpm exec vitest run test/store/stop-all.test.ts` exit 1 (2229ms)
- `pnpm exec vitest run test/store/stop-all.test.ts` exit 0 (2762ms)
- `pnpm check` exit 0 (12174ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts` exit 1 (2645ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts` exit 1 (3140ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts test/store/stop-all.test.ts` exit 0 (2603ms)
- `pnpm check` exit 0 (11514ms)
- `pnpm exec vitest run test/store/messages.test.ts` exit 0 (2221ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts` exit 0 (2223ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (2168ms)
- `pnpm exec vitest run test/core/claims.test.ts test/store/claims.test.ts` exit 0 (2468ms)
- `pnpm exec vitest run test/core/overlap.test.ts` exit 0 (2060ms)
- `pnpm exec vitest run test/store/retention.test.ts` exit 0 (3195ms)
- `pnpm check` exit 0 (14022ms)
- `pnpm exec vitest run test/store/messages.test.ts` exit 0 (3439ms)
- `pnpm exec vitest run test/core/fanout-and-cap.test.ts` exit 0 (3171ms)
- `pnpm exec vitest run test/core/guards.test.ts` exit 0 (2914ms)
- `pnpm exec vitest run test/core/claims.test.ts test/store/claims.test.ts` exit 0 (3685ms)
- `pnpm exec vitest run test/core/overlap.test.ts` exit 0 (3337ms)
- `pnpm exec vitest run test/store/retention.test.ts` exit 0 (3452ms)
