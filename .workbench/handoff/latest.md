# Handoff 2026-11-07T17:16:51+00:00

- Task: M3
- HEAD: `d9c65792e062`
- Verification: PASS (stale: files changed since) `.workbench/tasks/M3/verification.json`
- Review: `none`

- Mode: checkpoints (M3 CLI basics + four M2 review follow-ups; pnpm check and wb verify PASS; 107 tests.)

## Summary
M3 (CLI basics) closed: wb verify PASS (107 tests). Added the parley-mcp commander CLI — serve (wiring the M2 MCP server over stdio), who, log, export (md/jsonl), inbox drain|watch|register, hook edit — plus the Adapter interface and a fake adapter driving setup (--dry-run + idempotent) / uninstall (byte-for-byte restore) / doctor, and a viewer stub for M6. Folded in the four M2 review follow-ups (serve close handling before connect + stdin end/close + ServeHandle; participant-not-recipient agreement guard test; offered_to NOT NULL folded into migration 1 with migration 2 dropped; overlap.ts and serve-test tidy). Built by Kiro.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)

## Next action
M3 (CLI basics) is done and committed locally (not pushed). Next: M4 (Claude Code adapter) using the Adapter interface in src/adapters/types.ts and the fake adapter in src/adapters/fake as the pattern, OR M3b (the work harness adapter) once docs/harness-notes.md names the work harness — PLAN says build the work harness adapter first, before M4. Both need (H) steps: trusting hooks, restarting a harness, and testing two real agent sessions (idle session answers within 5 s). The adapter-facing CLI commands (inbox drain|watch|register, hook edit) and the serve wiring are ready for an adapter to call. Reminder: `pnpm run format` churns the whole repo; don't run it repo-wide. CI is still blocked by the GitHub billing lock (human-only fix).

## Changed files
- `docs/PROGRESS.md`
- `docs/harness-notes.md`
- `package.json`
- `pnpm-lock.yaml`
- `src/adapters/fake/index.ts`
- `src/adapters/index.ts`
- `src/adapters/types.ts`
- `src/cli/bin.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/export.ts`
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
- `src/core/overlap.ts`
- `src/mcp/server.ts`
- `src/store/migrations.ts`
- `test/cli/commands.test.ts`
- `test/cli/setup.test.ts`
- `test/mcp/serve.test.ts`
- `test/store/agreements.test.ts`

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
