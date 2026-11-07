# Harness notes

Record verified harness details here: versions, hook payloads, config paths, and what was verified versus assumed. No secrets or personal data.

(No real harness verified yet.)

## M3 (2026-11-07): adapter framework, no real harness yet

- The `Adapter` interface (`src/adapters/types.ts`) matches PLAN section 6:
  `detect` / `install` / `uninstall` / `doctor`, user-level config only, idempotent,
  merges never overwrite.
- M3 ships only a **fake adapter** (`src/adapters/fake/`) to exercise the
  setup / uninstall / doctor framework. It writes one user-level JSON file
  (`~/.parley-fake/config.json`), merges a `parley` key, and on uninstall removes
  exactly what it added (deleting the file it created, or unmerging its key from a
  pre-existing file). No harness hook payloads, versions or config paths are verified
  yet — that work starts at M4 (Claude Code) or M3b (the work harness, once named).
- The adapter-facing CLI commands exist: `inbox drain|watch|register` and `hook edit`.
  Real harnesses will call these from their hooks/monitors (M4+).
