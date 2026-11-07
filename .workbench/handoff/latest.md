# Handoff 2026-11-07T18:50:25+00:00

- Task: (none)
- HEAD: `e7dfaba7d0a4`
- Verification: PASS `.workbench/verification.json`
- Review: `none`

- Mode: checkpoints (M3 CLI basics + four M2 review follow-ups; pnpm check and wb verify PASS; 107 tests.)

## Summary
M3 (CLI basics) closed: wb verify passes (107 tests); independent review passed 8/10 on the first completed round. Built by kiro-cli (scoped parley-builder agent).

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)

## Next action
Next: M3b (work harness adapter, once the human names it) or M4 (Claude Code adapter); both need the human for two-session testing. FIRST, before any real adapter: fix the fake adapter's uninstall (it recursively deletes its parent dir; must only remove what install created, and a dir only if install created it and it is empty), since real adapters will copy it into ~/.claude etc. Also fold in: a test through buildProgram/commander for setup --dry-run asserting the temp HOME is untouched; error on unknown --format; test the transport.onclose close path; record the Adapter interface deviation (env, dryRun, fake) and add 'hooks trusted?' to DoctorReport; trailing newline in overlap.ts.

## Changed files
- none

## Open risks
- blocker: GitHub Actions won't start any job: 'The job was not started because your account is locked due to a billing issue.' (seen 2026-11-07, even after making the repo public). Only the human can fix it, at github.com/settings/billing.

## Failed attempts
- pnpm run lint (exit 1)

## Commands (last 30)
- `pnpm exec vitest run test/mcp/serve.test.ts test/store/agreements.test.ts test/store/db.test.ts` exit 0 (3150ms)
- `pnpm check` exit 0 (13148ms)
- `pnpm add commander` exit 0 (2312ms)
- `pnpm run lint` exit 1 (7047ms)
- `bash -c pnpm run lint && pnpm run typecheck` exit 0 (7830ms)
- `pnpm check` exit 0 (13251ms)
- `pnpm run format` exit 0 (2525ms)
- `pnpm check` exit 0 (12514ms)
- `pnpm check` exit 0 (12688ms)
- `pnpm check` exit 0 (14852ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2358ms)
- `pnpm exec vitest run test/cli/commands.test.ts` exit 0 (2742ms)
- `pnpm exec vitest run test/mcp/serve.test.ts` exit 0 (2451ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (2240ms)
- `pnpm check` exit 0 (13104ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2057ms)
- `pnpm exec vitest run test/cli/commands.test.ts` exit 0 (2262ms)
- `pnpm exec vitest run test/mcp/serve.test.ts` exit 0 (2257ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (2043ms)
- `pnpm check` exit 0 (32810ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (5437ms)
- `pnpm exec vitest run test/cli/commands.test.ts` exit 0 (6380ms)
- `pnpm exec vitest run test/mcp/serve.test.ts` exit 0 (6362ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (5708ms)
- `pnpm check` exit 0 (30218ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (4721ms)
- `pnpm exec vitest run test/cli/commands.test.ts` exit 0 (5717ms)
- `pnpm exec vitest run test/mcp/serve.test.ts` exit 0 (4857ms)
- `pnpm exec vitest run test/store/agreements.test.ts` exit 0 (4408ms)
- `pnpm check` exit 0 (31911ms)
