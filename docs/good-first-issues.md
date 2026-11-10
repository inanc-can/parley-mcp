# Good first issues (drafts)

Drafts for the maintainer to open on GitHub with the `good first issue` label. Each one is a single,
self-contained PR. The adapter issues follow [adding-a-harness.md](adding-a-harness.md).

---

## 1. Adapter: Gemini CLI

Add `src/adapters/gemini/` so Gemini CLI sessions can join Parley as `gemini@<folder>`.

- Find, in Gemini CLI's official docs, where a user-level MCP server and hooks are configured, and
  how an idle session can be woken (a background shell or monitor-like mechanism, if any).
- Record findings in `docs/harness-notes.md` (verified vs assumed).
- Install / uninstall / doctor with tests in a temporary HOME; synthetic fixtures replayed through
  the hook commands.

**Done when** `mcp-parley setup --harness gemini` wires it up and a Gemini session can talk to a
Claude Code session.

## 2. Adapter: OpenCode

Add `src/adapters/opencode/` (`opencode@<folder>`). OpenCode has its own config file and a plugin
system; check whether a plugin can watch for messages and wake an idle session. Same deliverables
as issue 1.

## 3. Adapter: GitHub Copilot CLI

Add `src/adapters/copilot/` (`copilot@<folder>`). Find the user-level MCP config and any hook or
background-task mechanism. Same deliverables as issue 1.

## 4. Adapter: Goose

Add `src/adapters/goose/` (`goose@<folder>`). Goose has extensions and a config file; check how an
idle session can be resumed. Same deliverables as issue 1.

## 5. Replace synthetic fixtures with real ones (any harness)

The fixtures in `src/adapters/*/fixtures/` are synthetic (`"_synthetic": true`), built from the
docs. Capture real hook payloads from one harness (add a temporary hook that writes stdin to a
file), anonymise paths, ids and emails, replace the synthetic files and keep the replay tests green.

## 6. Windows paths in overlap detection

`src/core/edit-paths.ts` handles POSIX paths only, so edits on Windows are not compared. Make
`repoRelativePath` and `normalizeClaimGlob` handle `C:\…` paths and backslashes (pure functions,
unit tests only). Bonus: make `isOurEntry` in the adapters recognise Windows launcher paths.

## 7. `mcp-parley who --json`

Add a `--json` flag to `who` that prints the agents as JSON (id, harness, alive, last seen), for
scripts and status lines. Small CLI change plus a test.

## 8. Viewer: filter threads

Add a search box to the viewer's thread list that filters by title or participant. Plain DOM in
`src/viewer/static/app.ts`, no framework; it must keep working at 375 px wide.

## 9. Viewer: show active claims

Show each agent's active claims (`src/auth/**`, expiry time) in the viewer's agent list, using the
existing claims store. Add the data to `GET /api/state` with a test in `test/viewer/`.

## 10. Split `test/adapters/claude-code.test.ts`

The file is at the 400-line limit. Split it by topic (install, uninstall, doctor, monitor script)
without changing what is tested.
