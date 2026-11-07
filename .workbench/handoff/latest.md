# Handoff 2026-11-07T19:35:05+00:00

- Task: M4
- HEAD: `04dd67bc4c08`
- Verification: PASS `.workbench/tasks/M4/verification.json`
- Review: `.workbench/tasks/M4/review.json`

- Mode: checkpoints

## Summary
M4 review round 2: soft_fail 6/10. Two high findings: (1) the npm name parley-mcp belongs to an unrelated third-party package, and every installed hook/monitor/MCP entry runs `npx parley-mcp`, which would execute it; (2) hooks swallow messages that arrive mid-turn. Stopped per the workbench rule; nothing installed into the real ~/.claude.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)
- [autonomous] 2026-11-07: The M4 plugin-loading fix is held until the round-1 reviewer finishes, so the reviewer reads a stable tree; then plugin loading and the review findings go to the builder as one fix.

## Next action
After the human picks the npm name: a builder switches all installed commands to an absolute path to this repo's CLI (written at setup time), fixes hook message swallowing, reports claude command failures from setup/uninstall, passes --session from the monitor, records the monitor-registers-everywhere deviation, strengthens the monitor test, fixes live-test steps 1 and 7; then verify and review round 3; then the human's live test.

## Changed files
- `docs/PROGRESS.md`
- `docs/harness-notes.md`
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
- `src/adapters/fake/index.ts`
- `src/adapters/fs-ops.ts`
- `src/adapters/index.ts`
- `src/adapters/types.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/hook-events.ts`
- `src/cli/commands/hook-payloads.ts`
- `src/cli/commands/hook.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/uninstall.ts`
- `src/cli/index.ts`
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
- blocker: Human decision: the npm package name (parley-mcp is taken by an unrelated package). Until decided, adapters must call this repo's CLI by absolute path, never `npx parley-mcp`.
- blocker: GitHub Actions blocked by the account billing lock (human-only fix).

## Failed attempts
- pnpm exec vitest run test/adapters/fs-ops.test.ts test/adapters/claude-code.test.ts test/cli/hook.test.ts test/cli/program.test.ts test/cli/setup.test.ts (exit 1)
- pnpm check (exit 1)
- pnpm exec tsc --noEmit (exit 2)
- pnpm exec eslint . (exit 1)

## Commands (last 30)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2266ms)
- `pnpm exec vitest run test/adapters/fs-ops.test.ts test/adapters/claude-code.test.ts test/cli/hook.test.ts test/cli/program.test.ts test/cli/setup.test.ts` exit 1 (2979ms)
- `pnpm check` exit 1 (11497ms)
- `pnpm check` exit 0 (22957ms)
- `pnpm check` exit 0 (23607ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (3237ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (3143ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (3478ms)
- `pnpm check` exit 0 (22640ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2504ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (3045ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2789ms)
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
