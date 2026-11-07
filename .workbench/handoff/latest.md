# Handoff 2026-11-07T20:45:05+00:00

- Task: (none)
- HEAD: `400ead244a59`
- Verification: PASS `.workbench/verification.json`
- Review: `none`

- Mode: checkpoints (M4 fix round 3 (Kiro): monitor-delivery requeue via SessionStart/SessionEnd, stale-doc refresh, build smoke test. wb verify PASS. Next: the human's live two-session test closes M4.)

## Summary
M4 (Claude Code adapter) closed after the human-assisted live test passed: idle web session woke <1 s after api's message, read 1 s later, replied on its own in the same thread 10 s later (2026-11-07 20:43 UTC, Claude Code 2.1.319). Five reviews; live-test bugs fixed in a7a14c9 and 400ead2. 164 tests, wb verify passes.

## Decisions made without asking (review these)
- [autonomous] 2026-11-07: GLM-5.3-Flash free and DeepSeek/MiMo free hit OpenCode's free usage limit mid-M2 (GLM resets in ~9.7 h). M2 continued in the same OpenCode session on opencode/nemotron-3.5-super-vl-free, the free model that still answered, instead of waiting or paying. Reversible: all work is in git. (Re-added by Claude: the builder's state rewrite dropped it.)
- [autonomous] 2026-11-07: The M4 plugin-loading fix is held until the round-1 reviewer finishes, so the reviewer reads a stable tree; then plugin loading and the review findings go to the builder as one fix.
- [autonomous] 2026-11-07: The M4 round-2 fixes proceed without waiting for the npm-name decision, because the fix (installed commands call this repo's CLI by absolute path, written at setup time) is name-independent. Only the published npm name (M12) stays a blocker for the human.
- Name decided by the human (2026-11-07): the npm package and CLI command are `mcp-parley` (Claude advised against it as a word-swap of the unrelated `parley-mcp` package; the human chose it anyway). [autonomous] follow-ons: data dir becomes ~/.mcp-parley, plugin/marketplace names use mcp-parley, the repo folder and GitHub repo stay `parley-mcp` (renaming the GitHub repo is an outward action for the human).
- [autonomous] 2026-11-07 (Claude): instead of adding tsx (not an allowed dependency), added a `build` script (tsc -p tsconfig.build.json -> dist/). cliEntryPath already prefers dist/cli/bin.js, so a launcher written by setup run from dist/ uses plain node. Running setup from the .ts source still writes a tsx launcher (a known limitation; the live-test steps use the build). Found and fixed while building: src/mcp/server.ts imported SDK subpaths without .js, which works under Vitest but crashes real Node; guarded by test/cli/build-imports.test.ts.
- [autonomous] 2026-11-07: Review round 3 passed (7/10) but found monitor deliveries are never requeued (high). Fixing it, and the stale docs, before the human's live test, so the test can cover requeue too; not a new review round, since the verdict was pass.
- [autonomous] 2026-11-07, live-test fix round (Claude): (1) MCP key, plugin and marketplace renamed to mcp-parley; setup never overwrites and uninstall never removes an entry under that key that it did not create (commands ending in /.mcp-parley/bin/mcp-parley are ours). Cause: the old key `parley` collided with the research Parley server and setup overwrote it. (2) Identity follows the Claude session: hooks look up the agent by session_id (cwd only as fallback) so a session that cd's keeps its agent; the MCP server names itself after the session folder (process.cwd()), not the repo root, records CLAUDE_CODE_SESSION_ID, and reuses the session's agent if SessionStart registered it first. Known limit: two sessions started in the same folder still share one agent (the monitor has no session id). (3) A monitor drain refreshes liveness. (4) Monitor lines carry the message id and say how to reply; talk's description says to answer peer messages. (5) Manifests get description/author; failed claude commands report stdout when stderr is empty.
- [autonomous] 2026-11-07: review round 4 (soft_fail 5/10) findings fixed directly; reply_to with no thread_id now joins the original's thread (live re-test showed reply_to_unknown). isOurEntry treats any command ending in /.mcp-parley/bin/mcp-parley as ours (another install counts as ours; Windows paths unsupported): a known limit for later.

## Next action
Human decisions: push the local commits; restore the research Parley `parley` MCP entry the old setup overwrote (from parley/README.md). Then M5 (Codex adapter) or M3b (work harness). Follow-ups for the next milestone: capture real hook payloads as fixtures (synthetic still), live-check requeue-on-close, two sessions started in one folder share an agent, isOurEntry suffix rule (Windows).

## Changed files
- none

## Open risks
- blocker: GitHub Actions blocked by the account billing lock (human-only fix).

## Failed attempts
- pnpm check (exit 2)

## Commands (last 30)
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
- `pnpm check` exit 2 (14193ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (3037ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2993ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2664ms)
- `pnpm check` exit 0 (23873ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (3358ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (3222ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (3245ms)
- `pnpm check` exit 0 (31565ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (3611ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (3960ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (3480ms)
- `pnpm check` exit 0 (27773ms)
- `pnpm exec vitest run test/cli/setup.test.ts` exit 0 (2687ms)
- `pnpm exec vitest run test/adapters/claude-code.test.ts` exit 0 (2937ms)
- `pnpm exec vitest run test/cli/hook.test.ts` exit 0 (2655ms)
- `pnpm check` exit 0 (18706ms)
