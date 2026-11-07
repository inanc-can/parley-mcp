# M4 fix round (kiro-M4-fix)

## Goal
Fix the review findings and plugin-loading before the human's live two-session test. Keep
`pnpm check` green and the adapter behaviour faithful to PLAN sections 4.3 and 6.

## Facts (with receipts)
- Identity split: MCP entry in `src/adapters/claude-code/plugin-files.ts` has no `env`, so the
  server resolves `mcp@<folder>` (`src/mcp/identity.ts` reads `PARLEY_HARNESS`, default `mcp`)
  while hooks/monitor use `claude@<folder>` (`hook-payloads.ts#claudeAgentId`). review.json HIGH.
- Plugin loading: a folder under `~/.claude/plugins/parley` does NOT load; need a local
  marketplace + `claude plugin install`, run through an injectable runner
  (`.workbench/tasks/M4/plugin-loading.md`).
- `PostToolUse` is registered twice (Edit matcher + no matcher) -> edits processed twice
  (`plugin-files.ts` HOOKS_JSON).
- `session-end` requeues across all sessions (`exceptSession=null`) not just the ending one
  (`hook-events.ts:112`; repo supports a non-null exceptSession already).
- `monitor.sh` exits for good if the agent isn't registered yet (race with SessionStart).
- Hook handlers print status lines to stdout via `deps.write`; SessionStart/UserPromptSubmit stdout
  becomes model context. Only deliveries should reach stdout.
- `fakeAdapter` is still in the production `ADAPTERS` list (`src/adapters/index.ts`).
- Stop hook uses `last_assistant_message` as read evidence — beyond PLAN 4.3.

## Allowed / forbidden
Allowed: src/adapters/**, src/cli/**, src/core/**, src/store/**, test/**, docs/**, .workbench/**.
Forbidden: src/mcp/**, src/viewer/**, src/notify/**, package.json, pnpm-lock.yaml.
Note: the identity fix needs NO src/mcp change — `PARLEY_HARNESS=claude` in the MCP entry env is
enough because the server already honours it.

## Acceptance
- pnpm check
- new/updated tests: identity env on the installed entry + MCP/hook resolve to same id; marketplace
  install via fake runner; doctor uses `claude plugin list --json` and monitor files, incl. a test
  where monitor.sh is missing -> canWakeIdle false; single PostToolUse; two-session session-end
  requeue; monitor retry-until-registered; hooks stdout-silent except deliveries.

## Unknowns
- Exact `claude plugin list --json` shape: parse defensively with Zod, match on plugin name +
  enabled flag. Recorded in harness-notes.
