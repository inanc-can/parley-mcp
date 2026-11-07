# Agent rules

Every rule has a category and a deterministic `check`. A rule without a check belongs in
onboarding docs, not here. Add a rule only for a real incident or risk, and cite it.

## startup/read-state
- category: startup
- check: session_start_context (SessionStart hook injects state, active task, last verdict)
Read `.workbench/state.json` and the active task's scope before the first edit.

## startup/working-mode-chosen
- category: startup
- check: mode_chosen (PreToolUse hook denies code edits until `wb mode` records this session's mode)
Ask the user every session how the harness should work; never reuse an earlier answer.

## forbidden/secrets-and-git-internals
- category: forbidden
- check: scope_forbidden (PreToolUse hook denies; `wb verify` re-checks the diff)
Never write files matching `forbidden` in `.workbench/config.json`.

## forbidden/out-of-scope-writes
- category: forbidden
- check: scope_outside_allowed (PreToolUse hook asks the human; `wb verify` fails the diff)
While a task is active, edit only its `allowed_files`; never its `forbidden_files`.

## done/acceptance-passes
- category: definition_of_done
- check: acceptance_pass (`wb verify`; Stop hook blocks once if changes are unverified)
A task is done only when every acceptance and verify command exits zero on the current tree.

## uncertainty/human-unknowns-stop
- category: uncertainty
- check: frame_unknowns_classified (frame.md lists unknowns as discoverable/decidable/human/deferred)
Continue through discoverable and decidable unknowns. Stop and ask at human unknowns
(product behaviour, cost, risk, public compatibility) before the choice is buried in code.

## approval/new-dependency
- category: approval
- check: dependency_approval (`wb verify` fails if a dependency manifest changed without
  "new-dependency" in the task's scope.json `approvals`)
Adding or upgrading a dependency needs explicit human approval recorded in the scope contract.
