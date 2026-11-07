# Handoff 2026-11-07T20:18:29+00:00

- Task: M4
- HEAD: `72b71bf50b4a`
- Verification: PASS `.workbench/tasks/M4/verification.json`
- Review: `.workbench/tasks/M4/review.json`

- Mode: checkpoints (M4 fix round 3 (Kiro): monitor-delivery requeue via SessionStart/SessionEnd, stale-doc refresh, build smoke test. wb verify PASS. Next: the human's live two-session test closes M4.)

## Summary
M4 (Claude Code adapter) automated part done: review round 3 passed 7/10; its high finding (monitor deliveries never requeued) fixed by Kiro with end-to-end hook tests; build smoke test added. wb verify passes, 157 tests.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)
- [autonomous] 2026-11-07: The M4 plugin-loading fix is held until the round-1 reviewer finishes, so the reviewer reads a stable tree; then plugin loading and the review findings go to the builder as one fix.
- [autonomous] 2026-11-07: The M4 round-2 fixes proceed without waiting for the npm-name decision, because the fix (installed commands call this repo's CLI by absolute path, written at setup time) is name-independent. Only the published npm name (M12) stays a blocker for the human.
- Name decided by the human (2026-11-07): the npm package and CLI command are `mcp-parley` (Claude advised against it as a word-swap of the unrelated `parley-mcp` package; the human chose it anyway). [autonomous] follow-ons: data dir becomes ~/.mcp-parley, plugin/marketplace names use mcp-parley, the repo folder and GitHub repo stay `parley-mcp` (renaming the GitHub repo is an outward action for the human).
- [autonomous] 2026-11-07 (Claude): instead of adding tsx (not an allowed dependency), added a `build` script (tsc -p tsconfig.build.json -> dist/). cliEntryPath already prefers dist/cli/bin.js, so a launcher written by setup run from dist/ uses plain node. Running setup from the .ts source still writes a tsx launcher (a known limitation; the live-test steps use the build). Found and fixed while building: src/mcp/server.ts imported SDK subpaths without .js, which works under Vitest but crashes real Node; guarded by test/cli/build-imports.test.ts.
- [autonomous] 2026-11-07: Review round 3 passed (7/10) but found monitor deliveries are never requeued (high). Fixing it, and the stale docs, before the human's live test, so the test can cover requeue too; not a new review round, since the verdict was pass.

## Next action
Human: run the live two-session test in docs/PROGRESS.md (pnpm build; node dist/cli/bin.js setup --harness claude-code; two Claude Code sessions in a throwaway repo; idle wake within 5 s; receipts; requeue on close; uninstall). M4 closes only after it passes. Pushing is the human's call.

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
- `src/cli/commands/log.ts`
- `src/cli/commands/serve.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/uninstall.ts`
- `src/cli/commands/viewer.ts`
- `src/cli/commands/who.ts`
- `src/cli/context.ts`
- `src/cli/index.ts`
- `src/mcp/server.ts`
- `src/store/repos/messages-repo.ts`
- `test/adapters/claude-code-fixtures.test.ts`
- `test/adapters/claude-code.test.ts`
- `test/adapters/fs-ops.test.ts`
- `test/cli/build-imports.test.ts`
- `test/cli/build-smoke.test.ts`
- `test/cli/commands.test.ts`
- `test/cli/hook.test.ts`
- `test/cli/program.test.ts`
- `test/cli/setup.test.ts`
- `test/store/messages.test.ts`
- `tsconfig.build.json`

## Open risks
- blocker: GitHub Actions blocked by the account billing lock (human-only fix).
- blocker: M4 live two-session test needs the human (it installs into the real ~/.claude and needs two interactive Claude Code sessions).

## Failed attempts
- pnpm exec vitest run test/cli/build-smoke.test.ts (exit 1)

## Commands (last 30)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2716ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2646ms)
- `pnpm check` exit 0 (31360ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (4962ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (5537ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (4965ms)
- `pnpm check` exit 0 (28698ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (4395ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (5662ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (4846ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (4492ms)
- `pnpm exec vitest run test/store` exit 0 (4879ms)
- `pnpm exec eslint src/cli/commands/hook-events.ts src/store/repos/messages-repo.ts test/cli/hook.test.ts` exit 0 (6948ms)
- `pnpm exec vitest run test/cli/build-smoke.test.ts` exit 1 (7382ms)
- `pnpm exec vitest run test/cli/build-smoke.test.ts` exit 0 (8199ms)
- `pnpm exec vitest run test/cli/build-smoke.test.ts` exit 0 (7782ms)
- `pnpm exec eslint test/cli/build-smoke.test.ts` exit 0 (6118ms)
- `pnpm check` exit 0 (31397ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (4969ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (5007ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (5158ms)
- `node -e JSON.parse(require('fs').readFileSync('.workbench/state.json','utf8')); console.log('state.json OK')` exit 0 (142ms)
- `pnpm check` exit 0 (21446ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2635ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2931ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2808ms)
- `pnpm check` exit 0 (23064ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2583ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (3016ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2917ms)
