import { join } from "node:path";

/**
 * The user-level files the Cursor adapter manages (PLAN section 6 "Cursor"),
 * verified against Cursor's official docs on 2026-11-07
 * (cursor.com/docs/hooks.md, cursor.com/docs/mcp.md; docs/harness-notes.md M8):
 *
 *  - `~/.cursor/mcp.json`: `{ "mcpServers": { "<name>": { command, args, env } } }`.
 *    Cursor supports MCP roots, which is how a user-level server learns the
 *    open folder (`${workspaceFolder}` only resolves in a project mcp.json).
 *  - `~/.cursor/hooks.json`: `{ "version": 1, "hooks": { "<event>": [{ "command": … }] } }`.
 *    User hooks run from `~/.cursor/`, need no trust step, and Cursor reloads
 *    the file on save.
 *
 * Every command is this install's absolute launcher (never `npx`).
 */

export const CURSOR_DIR_REL = ".cursor";
export const MCP_JSON_REL = join(CURSOR_DIR_REL, "mcp.json");
export const HOOKS_JSON_REL = join(CURSOR_DIR_REL, "hooks.json");

/** Same key as the other adapters; never `parley` (another tool uses it). */
export const MCP_SERVER_KEY = "mcp-parley";

export function mcpServerEntry(launcherPath: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { command: launcherPath, args: ["serve"], env: { PARLEY_HARNESS: "cursor" } };
}

export interface CursorHookDef {
  event: string;
  subcommand: string;
  /** Extra per-script options from the docs (e.g. `loop_limit` for stop). */
  extra?: Record<string, unknown>;
}

/**
 * The hooks we install and the `mcp-parley hook <subcommand>` each runs.
 *
 * `stop` gets `loop_limit: null`: Cursor counts stop follow-ups per
 * conversation and stops after 5 by default, which would silently cut off
 * message delivery in a long chat. Parley's own guards bound the loop instead
 * (the 20-message thread cap, stop-all, and a follow-up only when messages are
 * actually queued).
 */
export const CURSOR_HOOKS: readonly CursorHookDef[] = [
  { event: "sessionStart", subcommand: "cursor-session-start" },
  { event: "beforeSubmitPrompt", subcommand: "cursor-prompt" },
  { event: "afterFileEdit", subcommand: "cursor-after-edit" },
  { event: "stop", subcommand: "cursor-stop", extra: { loop_limit: null } },
  { event: "sessionEnd", subcommand: "cursor-session-end" },
];

export function hookCommand(launcherPath: string, subcommand: string): string {
  return `"${launcherPath}" hook ${subcommand}`;
}

export function hookEntry(launcherPath: string, def: CursorHookDef): Record<string, unknown> {
  return { command: hookCommand(launcherPath, def.subcommand), ...(def.extra ?? {}) };
}

/**
 * The context Cursor adds to a new chat (sessionStart `additional_context`).
 * Cursor and Grok are the two adapters that need instruction text, because
 * the agent starts its own watcher (PLAN section 6). It goes through hook
 * output, never through a rules file in the repo.
 */
export function sessionContext(launcherPath: string, agentId: string, sessionId: string): string {
  const watch = `"${launcherPath}" inbox watch --agent ${agentId} --session ${sessionId} --once`;
  return [
    `mcp-parley: this Cursor chat is agent ${agentId}; other coding agents on this machine can message it.`,
    `To hear from them while you are idle, start exactly one background shell task that Cursor owns (not a separate terminal) running:`,
    watch,
    `Leave it running when your turn ends. It waits silently and exits after printing one message, which resumes you.`,
    `Answer that message with the talk tool (reply_to its id), then start the same command again.`,
    `If one is already running, do not start a second.`,
  ].join("\n");
}
