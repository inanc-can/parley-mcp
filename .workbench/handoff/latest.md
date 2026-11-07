# Handoff 2026-11-07T19:58:06+00:00

- Task: M4
- HEAD: `620cec024771`
- Verification: PASS `.workbench/tasks/M4/verification.json`
- Review: `.workbench/tasks/M4/review.json`

- Mode: checkpoints (Finish M4 fix round 2 (mcp-parley rename, no-npx launcher, mid-turn delivery), then review round 3 and the human's live test.)

## Summary
M4 fix round 2 (kiro-M4-fix2): applied review-round-2 (soft_fail 6/10). Renamed to mcp-parley (data dir ~/.mcp-parley, PARLEY_DB_PATH kept; .parley/rules.md and PARLEY_* env NOT renamed; repo/GitHub stay parley-mcp). No installed config runs npx: a launcher at ~/.mcp-parley/bin/mcp-parley runs this install by absolute path and every MCP entry/hook/monitor/fake config points at it; doctor verifies the command points at this install. PostToolUse/Stop no longer drain (additionalContext is unreliable) so the monitor is the sole mid-turn delivery path; test proves a mid-turn message still reaches Claude. setup/uninstall surface claude command failures. Monitor passes --session monitor-$$ so delivered_session is recorded and requeue works. readPluginState is strict. Monitor-registers-everywhere deviation recorded. Live-test steps 1 and 7 fixed (exact tsx setup command; viewer-free receipts check). pnpm check green, 30 files / 154 tests.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)
- [autonomous] 2026-11-07: The M4 plugin-loading fix is held until the round-1 reviewer finishes, so the reviewer reads a stable tree; then plugin loading and the review findings go to the builder as one fix.
- [autonomous] 2026-11-07: The M4 round-2 fixes proceed without waiting for the npm-name decision, because the fix (installed commands call this repo's CLI by absolute path, written at setup time) is name-independent. Only the published npm name (M12) stays a blocker for the human.
- Name decided by the human (2026-11-07): the npm package and CLI command are `mcp-parley` (Claude advised against it as a word-swap of the unrelated `parley-mcp` package; the human chose it anyway). [autonomous] follow-ons: data dir becomes ~/.mcp-parley, plugin/marketplace names use mcp-parley, the repo folder and GitHub repo stay `parley-mcp` (renaming the GitHub repo is an outward action for the human).

## Next action
M4 fix round 2 complete; run review round 3 (independent reviewer reads the diff + wb verify verdict), then the human's live two-session test (PROGRESS.md 'fix round 2' steps) is M4's remaining (H) acceptance. Open follow-up for the human: decide whether to add `tsx` as a dev dependency (the launcher needs it until M12 produces a compiled bin.js) — NOT added silently. Blocker unchanged: GitHub Actions billing lock.

## Changed files
- `docs/PLAN.md`
- `docs/PROGRESS.md`
- `docs/harness-notes.md`
- `package.json`
- `src/adapters/claude-code/fixtures/post-tool-edit.json`
- `src/adapters/claude-code/fixtures/session-end.json`
- `src/adapters/claude-code/fixtures/session-start.json`
- `src/adapters/claude-code/fixtures/stop.json`
- `src/adapters/claude-code/fixtures/subagent-post-tool.json`
- `src/adapters/claude-code/fixtures/user-prompt.json`
- `src/adapters/claude-code/index.ts`
- `src/adapters/claude-code/install.ts`
- `src/adapters/claude-code/plugin-commands.ts`
- `src/adapters/claude-code/plugin-files.ts`
- `src/adapters/claude-code/runner.ts`
- `src/adapters/cli-path.ts`
- `src/adapters/fake/index.ts`
- `src/adapters/fs-ops.ts`
- `src/adapters/index.ts`
- `src/adapters/types.ts`
- `src/cli/bin.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/export.ts`
- `src/cli/commands/hook-events.ts`
- `src/cli/commands/hook-payloads.ts`
- `src/cli/commands/hook.ts`
- `src/cli/commands/inbox.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/uninstall.ts`
- `src/cli/context.ts`
- `src/cli/index.ts`
- `src/mcp/server.ts`
- `src/store/repos/messages-repo.ts`
- `test/adapters/claude-code-fixtures.test.ts`
- `test/adapters/claude-code.test.ts`
- `test/adapters/fs-ops.test.ts`
- `test/cli/commands.test.ts`
- `test/cli/hook.test.ts`
- `test/cli/program.test.ts`
- `test/cli/setup.test.ts`
- `test/store/messages.test.ts`

## Open risks
- blocker: GitHub Actions blocked by the account billing lock (human-only fix).

## Failed attempts
- pnpm exec tsc --noEmit (exit 2)
- pnpm exec eslint . (exit 1)
- pnpm check (exit 1)

## Commands (last 30)
- `pnpm check` exit 0 (41420ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (4881ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (4857ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (4609ms)
- `pnpm exec tsc --noEmit` exit 2 (2605ms)
- `pnpm exec tsc --noEmit` exit 0 (3236ms)
- `pnpm exec eslint .` exit 1 (9116ms)
- `pnpm exec eslint .` exit 0 (7496ms)
- `pnpm exec vitest run` exit 0 (5396ms)
- `pnpm check` exit 0 (19248ms)
- `pnpm check` exit 0 (16808ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2490ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2901ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2778ms)
- `pnpm check` exit 0 (37959ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (5867ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (5420ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (5207ms)
- `pnpm run typecheck` exit 0 (3059ms)
- `pnpm check` exit 1 (9126ms)
- `pnpm check` exit 0 (21424ms)
- `pnpm check` exit 0 (21173ms)
- `pnpm check` exit 0 (16506ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2569ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2790ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2629ms)
- `pnpm check` exit 0 (16099ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2393ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2716ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2646ms)
