# Handoff 2026-11-07T19:09:09+00:00

- Task: M4
- HEAD: `dda5a2278a4a`
- Verification: PASS `.workbench/tasks/M4/verification.json`
- Review: `none`

- Mode: checkpoints

## Summary
M4 (Claude Code adapter) build complete: pnpm check passes (30 files, 139 tests) and wb verify PASS. Step 1 fixed the M3 review must-fix (fake adapter's recursive uninstall -> shared safe removeFileIfPresent/removeDirIfEmpty; a non-empty dir survives) and the other M3 follow-ups (unknown --format errors, buildProgram dry-run test, DoctorReport.hooksTrusted, documented Adapter deviation). Built src/adapters/claude-code: ~/.claude.json mcpServers.parley registration + a plugin (plugin.json, hooks.json, monitors.json, scripts) with hook handlers for SessionStart/UserPromptSubmit/Stop/PostToolUse/SessionEnd that ignore subagent payloads and take UserPromptSubmit read-evidence. The (H) live two-session test remains for the human (steps in docs/PROGRESS.md); fixtures are synthetic until then.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)

## Next action
M4 build is complete and verified (wb verify PASS, 139 tests). REMAINING for M4: the human runs the live two-session acceptance test (PLAN marks it (H)); exact steps are in docs/PROGRESS.md 'Human live two-session test'. During that test, capture real anonymised Claude Code hook payloads into src/adapters/claude-code/fixtures/ (replacing the synthetic ones) and confirm the assumed bits in docs/harness-notes.md (monitor agent-id derivation, monitor stdout -> notification, parent-pid exit guard, UserPromptSubmit read-evidence echo). Then an independent reviewer should read the M4 diff. After M4 sign-off: M5 (Codex adapter) or M3b (the work harness adapter) once the human names the work harness in docs/harness-notes.md.

## Changed files
- `docs/PROGRESS.md`
- `src/adapters/claude-code/fixtures/post-tool-edit.json`
- `src/adapters/claude-code/fixtures/session-end.json`
- `src/adapters/claude-code/fixtures/session-start.json`
- `src/adapters/claude-code/fixtures/stop.json`
- `src/adapters/claude-code/fixtures/subagent-post-tool.json`
- `src/adapters/claude-code/fixtures/user-prompt.json`
- `src/adapters/claude-code/index.ts`
- `src/adapters/claude-code/install.ts`
- `src/adapters/claude-code/plugin-files.ts`
- `src/adapters/fake/index.ts`
- `src/adapters/fs-ops.ts`
- `src/adapters/index.ts`
- `src/adapters/types.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/hook-events.ts`
- `src/cli/commands/hook-payloads.ts`
- `src/cli/index.ts`
- `src/store/repos/messages-repo.ts`
- `test/adapters/claude-code-fixtures.test.ts`
- `test/adapters/claude-code.test.ts`
- `test/adapters/fs-ops.test.ts`
- `test/cli/hook.test.ts`
- `test/cli/program.test.ts`
- `test/cli/setup.test.ts`

## Open risks
- blocker: GitHub Actions won't start any job: 'The job was not started because your account is locked due to a billing issue.' (seen 2026-11-07, even after making the repo public). Only the human can fix it, at github.com/settings/billing.

## Failed attempts
- pnpm exec vitest run test/adapters/fs-ops.test.ts test/adapters/claude-code.test.ts test/cli/hook.test.ts test/cli/program.test.ts test/cli/setup.test.ts (exit 1)
- pnpm check (exit 1)

## Commands (last 30)
- `pnpm exec tsc --noEmit` exit 0 (4103ms)
- `pnpm exec tsc --noEmit` exit 0 (2234ms)
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
