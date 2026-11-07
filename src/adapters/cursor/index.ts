import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterEnv, DetectReport } from "../types.js";
import { CURSOR_DIR_REL } from "./config-files.js";
import { doctorCursor, installCursor, uninstallCursor } from "./install.js";

/**
 * The Cursor adapter (PLAN section 6 "Cursor"): MCP server in
 * ~/.cursor/mcp.json, hooks in ~/.cursor/hooks.json. Idle wake works through a
 * Cursor-owned background `inbox watch --once` task the agent starts when told
 * to by the sessionStart hook, with the stop hook's follow-up as a fallback.
 */
export const cursorAdapter: Adapter = {
  harness: "cursor",
  detect(env: AdapterEnv): Promise<DetectReport> {
    return Promise.resolve({ installed: existsSync(join(env.home, CURSOR_DIR_REL)) });
  },
  install(env: AdapterEnv, dryRun: boolean) {
    return Promise.resolve(installCursor(env, dryRun));
  },
  uninstall(env: AdapterEnv) {
    return Promise.resolve(uninstallCursor(env));
  },
  doctor(env: AdapterEnv) {
    return Promise.resolve(doctorCursor(env));
  },
};
