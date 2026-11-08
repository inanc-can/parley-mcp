import { join } from "node:path";

/**
 * The user-level files the Grok Build adapter manages (PLAN section 6 "Grok
 * Build"), verified against docs.x.ai/build on 2026-11-08 (docs/harness-notes.md
 * M9):
 *
 *  - `~/.grok/config.toml`: `[mcp_servers.mcp-parley]`, merged as a fenced block
 *    (shared with Codex, ../toml-merge.ts). config.toml outranks the Claude and
 *    Cursor MCP files Grok also reads, so a Grok session gets PARLEY_HARNESS=grok.
 *  - `~/.grok/hooks/mcp-parley.json`: our hooks, in a file of our own (personal
 *    hooks live in `~/.grok/hooks/*.json`; they need no trust step, only project
 *    hooks do).
 *  - `~/.grok/skills/mcp-parley/SKILL.md`: tells the agent to start its monitor.
 *    The docs leave the plugin manifest format open, so we use the documented
 *    user-level hooks and skills folders instead of a plugin.
 */

export const GROK_DIR_REL = ".grok";
export const CONFIG_TOML_REL = join(GROK_DIR_REL, "config.toml");
export const HOOKS_FILE_REL = join(GROK_DIR_REL, "hooks", "mcp-parley.json");
export const SKILL_FILE_REL = join(GROK_DIR_REL, "skills", "mcp-parley", "SKILL.md");

interface HookDef {
  event: string;
  subcommand: string;
  timeout?: number;
}

/** PascalCase events (docs table); default timeout is 5 s. */
const GROK_HOOKS: readonly HookDef[] = [
  { event: "SessionStart", subcommand: "grok-session-start", timeout: 10 },
  { event: "UserPromptSubmit", subcommand: "grok-user-prompt" },
  { event: "PostToolUse", subcommand: "grok-post-tool" },
  { event: "Stop", subcommand: "grok-stop" },
  { event: "SessionEnd", subcommand: "grok-session-end" },
];

export function hooksFileText(launcherPath: string): string {
  const hooks: Record<string, unknown[]> = {};
  for (const def of GROK_HOOKS) {
    const handler: Record<string, unknown> = { type: "command", command: `"${launcherPath}" hook ${def.subcommand}` };
    if (def.timeout !== undefined) {
      handler["timeout"] = def.timeout;
    }
    hooks[def.event] = [{ hooks: [handler] }];
  }
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

/** The persistent monitor command for an agent (PLAN: pass --agent; the monitor gets no session id). */
export function grokWatchCommand(launcherPath: string, agentId: string): string {
  return `"${launcherPath}" inbox watch --agent ${agentId} --provider grok`;
}

export function skillText(launcherPath: string): string {
  return [
    "---",
    "name: mcp-parley",
    "description: Keep this Grok session reachable by the other coding agents on this machine (Parley MCP). Use at the start of every session, and whenever an mcp-parley reminder asks for it.",
    "user-invocable: true",
    "---",
    "",
    "Other coding agents on this machine (Claude Code, Codex, Cursor) can message you through the mcp-parley MCP server.",
    "To hear them while you are idle, start exactly one persistent `monitor` running:",
    "",
    "```",
    grokWatchCommand(launcherPath, "grok@<folder>"),
    "```",
    "",
    "Replace `<folder>` with the name of your working directory (its last path part), for example `grok@web`.",
    "If the mcp-parley server's instructions or an mcp-parley reminder give you the exact command, use that one.",
    "",
    "Each line the monitor prints is a message from another agent. Answer it with the mcp-parley `talk` tool,",
    "using the `reply_to` id in the line. Do not start a second monitor when one is already running.",
    "",
  ].join("\n");
}
