# Adding a harness

A harness is a coding-agent app (Claude Code, Codex, Cursor, Grok Build, …). Supporting a new one
means writing an **adapter**: one folder under `src/adapters/<name>/`, registered in one list, with
its own tests. You should not need to touch the core, the store or the MCP tools.

Before writing code, read [PLAN.md](PLAN.md) sections 3 and 6, and the existing adapters
(`src/adapters/cursor/` is the smallest complete one).

## 1. Find out what the harness can do

Answer these from the harness's **official docs** and, if you can, a real session. Write every
answer in [harness-notes.md](harness-notes.md) under a new section, marking each fact *verified*
(with the source) or *assumed*.

1. **MCP config:** where does a user-level MCP server go, and in what format?
2. **Hooks:** which lifecycle events exist (session start, prompt submit, after a tool, turn end,
   session end)? Where are hooks configured, what JSON arrives on stdin, and what can a hook print
   back? Do hooks need trust or approval?
3. **Identity:** what session id does each hook get, and what is the working folder?
4. **Idle wake (the hard part):** how can something outside the session make an *idle* session
   start a turn? This decides whether the adapter can meet PLAN's "delivered within 5 seconds".
5. **Does it read other harnesses' files?** Grok Build, for example, also runs Claude Code's and
   Cursor's hooks. If so, those adapters' hooks must stand down when the new harness calls them.

## 2. Pick a wake mechanism

Parley already has three; reuse one if it fits.

| Pattern | Used by | How it works |
| --- | --- | --- |
| **Monitor** | Claude Code, Grok Build | A long-running command prints one line per message; the harness turns each line into a notification that wakes the session. |
| **One-shot background task** | Cursor | The agent starts `mcp-parley inbox watch --agent <id> --once`; it exits with one message, and the harness resumes the agent when a background task finishes. |
| **External API** | Codex | Parley calls the harness's own server (`turn/start`) to start a turn on the idle session. |

If the agent has to start its own watcher (Cursor, Grok), deliver the instruction through hook
output, a user-level skill or the MCP server's `instructions`, **never through a rules file in the
user's repository.**

Fallbacks keep messages safe: anything not delivered stays queued and reaches the agent through
the `inbox` tool or a turn-end hook.

## 3. Write the adapter

```
src/adapters/<name>/
  config-files.ts   paths, the MCP entry, the hook entries (pure)
  install.ts        install / uninstall / doctor
  index.ts          the Adapter object
  fixtures/         hook payloads (synthetic until you capture real ones)
```

The `Adapter` interface (`src/adapters/types.ts`):

```ts
interface Adapter {
  harness: HarnessName;                       // add your name to HarnessName
  detect(env): Promise<DetectReport>;         // offline check, e.g. does ~/.<name> exist?
  install(env, dryRun): Promise<InstallReport>;
  uninstall(env): Promise<InstallReport>;
  doctor(env): Promise<DoctorReport>;         // can it wake an idle session now? why not?
}
```

Register it in `ADAPTERS` in `src/adapters/index.ts`.

Rules every adapter follows (the tests for the existing adapters show how):

- **User-level config only.** Never write into the user's repositories.
- **Merge, never overwrite.** Keep the user's other entries; install twice is a no-op; uninstall
  removes exactly what install added. Reuse `src/adapters/toml-merge.ts` for TOML files.
- **Never touch a foreign entry.** An `mcp-parley` entry whose command is not an mcp-parley launcher
  belongs to someone else: leave it and say so in `notes`.
- **Never `npx`.** Every command runs `launcherPath(home)` from `src/adapters/cli-path.ts`.
- **MCP key `mcp-parley`**, with `env: { PARLEY_HARNESS: "<name>" }` so the server names itself
  `<name>@<folder>`, the same id the hooks use.

## 4. Write the hook commands

Hook logic lives in TypeScript under `src/cli/commands/`; the harness config only pipes the payload
into `mcp-parley hook <name>-<event>`. Map the harness's payload onto the shared handlers in
`src/cli/commands/hook-events.ts` (register, read evidence, edits, requeue), as
`cursor-hooks.ts` and `grok-hooks.ts` do:

- Parse the payload with Zod (`z.looseObject`) where it enters. No `any`, no `as`.
- Name the agent `<name>@<basename(cwd)>` and find it by session id first.
- Read evidence comes only from a message id seen in the model's input, an `inbox` call, or a
  reply. Never mark a message read from timing.
- Report edits through the shared post-tool handler so overlap warnings work. Paths are made
  repo-relative for you; if the harness reports edited files in an unusual shape, extend
  `src/core/edit-paths.ts`.
- Diagnostics go to stderr; stdout carries only what the harness should read.

## 5. Test it

- `test/adapters/<name>.test.ts`: install into a temporary HOME; idempotency; dry run; uninstall
  restores the user's files; foreign entries untouched; doctor.
- `test/cli/<name>-hooks.test.ts`: replay every fixture through the real hook commands.
- Fixtures start synthetic (`"_synthetic": true`). Replace them with real, anonymised payloads
  captured from a live session as soon as you can.
- `pnpm check` must pass.

Then do a live round trip: two sessions, the new harness idle, *"say hi to <name>@<folder>"* from the
other one. Record what happened in harness-notes.md and in the PR.
