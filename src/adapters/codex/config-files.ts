import { join } from "node:path";

/**
 * The user-level files the Codex adapter manages (PLAN section 6 "Codex",
 * verified in docs/harness-notes.md M5 against codex 0.154.0 +
 * learn.chatgpt.com/docs/hooks):
 *
 *  - `~/.codex/config.toml` — the MCP server registration, table
 *    `[mcp_servers.mcp-parley]`. We MERGE it in, preserving comments and every
 *    other table (a surgical text-level merge, see install.ts), never a full
 *    reserialize.
 *  - `~/.codex/hooks.json` — the lifecycle hooks (SessionStart, UserPromptSubmit,
 *    PostToolUse, Stop, SessionEnd), each a `type:"command"` handler invoking
 *    THIS install's absolute launcher (never `npx`).
 *
 * Every command a generated file runs is the absolute launcher path resolved at
 * setup time (src/adapters/cli-path.ts): the review's HIGH no-npx finding.
 */

/** The Codex home dir, relative to HOME. */
export const CODEX_DIR_REL = ".codex";

/** The config.toml path, relative to HOME. */
export const CONFIG_TOML_REL = join(CODEX_DIR_REL, "config.toml");

/** The hooks.json path, relative to HOME. */
export const HOOKS_JSON_REL = join(CODEX_DIR_REL, "hooks.json");

// The managed TOML block (key, table, fence markers) is shared with the Grok
// adapter; it lives in ../toml-merge.ts and is re-exported here.
export { BLOCK_BEGIN, BLOCK_END, MCP_SERVER_KEY, MCP_TABLE_HEADER, managedConfigBlock, mcpTableBlock } from "../toml-merge.js";

/**
 * The Codex hook event -> CLI subcommand mapping. The handler is a command hook
 * that pipes its stdin JSON payload into the launcher. Event names are
 * PascalCase (verified). `UserPromptSubmit` and `Stop` ignore any matcher, so
 * we omit it there; `PostToolUse` matches the file-editing tools.
 */
interface HookDef {
  event: string;
  subcommand: string;
  matcher?: string;
  timeout?: number;
}

const HOOK_DEFS: readonly HookDef[] = [
  { event: "SessionStart", subcommand: "codex-session-start", matcher: "startup|resume|clear|compact|fork", timeout: 10 },
  { event: "UserPromptSubmit", subcommand: "codex-user-prompt" },
  { event: "PostToolUse", subcommand: "codex-post-tool", matcher: "Edit|Write|apply_patch" },
  { event: "Stop", subcommand: "codex-stop" },
  // SessionEnd default timeout is 1 s, max 3 s (verified) — requeue is a quick DB write.
  { event: "SessionEnd", subcommand: "codex-session-end", timeout: 3 },
];

interface HookHandler {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
}

/** The hooks.json object. The launcher runs `hook <subcommand>` reading stdin. */
export function hooksJson(launcherPath: string): {
  description: string;
  hooks: Record<string, HookMatcherGroup[]>;
} {
  const hooks: Record<string, HookMatcherGroup[]> = {};
  for (const def of HOOK_DEFS) {
    const handler: HookHandler = { type: "command", command: `${quote(launcherPath)} hook ${def.subcommand}` };
    if (def.timeout !== undefined) {
      handler.timeout = def.timeout;
    }
    const group: HookMatcherGroup = { hooks: [handler] };
    if (def.matcher !== undefined) {
      group.matcher = def.matcher;
    }
    hooks[def.event] = [group];
  }
  return {
    description: "mcp-parley: wake and inform Codex when another agent messages it (managed by mcp-parley setup).",
    hooks,
  };
}

function quote(path: string): string {
  return `"${path}"`;
}

/** hooks.json serialized exactly as install writes it (stable key order + trailing newline). */
export function hooksJsonText(launcherPath: string): string {
  return `${JSON.stringify(hooksJson(launcherPath), null, 2)}\n`;
}
