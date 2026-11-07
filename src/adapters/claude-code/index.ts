import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterEnv, DetectReport } from "../types.js";
import { doctorClaudeCode, installClaudeCode, uninstallClaudeCode } from "./install.js";

/**
 * The Claude Code adapter (PLAN section 6). Registers the Parley MCP server at
 * user level (~/.claude.json, with PARLEY_HARNESS=claude so the MCP tools share
 * the hooks' agent id) and installs a Claude Code plugin through a local
 * marketplace (`claude plugin install`): the monitor wakes idle sessions and
 * the hooks register the agent, take read-evidence, drain at safe points and
 * requeue unread messages. User-level only, idempotent, merges never overwrite;
 * uninstall removes exactly what install created.
 */
export const claudeCodeAdapter: Adapter = {
  harness: "claude-code",

  detect(env: AdapterEnv): Promise<DetectReport> {
    // Presence of ~/.claude is a cheap, offline signal that Claude Code has run
    // on this machine. We never launch `claude` here. The human's live test
    // confirms the version; setup still writes user-level config even if absent.
    return Promise.resolve({ installed: hasClaudeHome(env) });
  },

  install(env: AdapterEnv, dryRun: boolean) {
    return Promise.resolve(installClaudeCode(env, dryRun));
  },

  uninstall(env: AdapterEnv) {
    return Promise.resolve(uninstallClaudeCode(env));
  },

  doctor(env: AdapterEnv) {
    return Promise.resolve(doctorClaudeCode(env));
  },
};

function hasClaudeHome(env: AdapterEnv): boolean {
  return existsSync(join(env.home, ".claude")) || existsSync(join(env.home, ".claude.json"));
}
