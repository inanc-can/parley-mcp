import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterEnv, DetectReport } from "../types.js";
import { CODEX_DIR_REL } from "./config-files.js";
import { doctorCodex, installCodex, uninstallCodex } from "./install.js";

/**
 * The Codex adapter (PLAN section 6 "Codex"). Registers the Parley MCP server
 * in ~/.codex/config.toml [mcp_servers.mcp-parley] (merged, comments and other
 * tables preserved), writes ~/.codex/hooks.json lifecycle hooks, and relies on
 * the app-server (turn/start / turn/steer) for idle wake with a fail-closed
 * fallback. User-level only, idempotent, merges never overwrite; uninstall
 * removes exactly what install created. Setup tells the human to trust the
 * hooks via /hooks.
 */
export const codexAdapter: Adapter = {
  harness: "codex",

  detect(env: AdapterEnv): Promise<DetectReport> {
    // Presence of ~/.codex is an offline signal that Codex has run here. We
    // never launch `codex` to detect. setup still writes user-level config even
    // if absent (the human may install Codex after).
    return Promise.resolve({ installed: existsSync(join(env.home, CODEX_DIR_REL)) });
  },

  install(env: AdapterEnv, dryRun: boolean) {
    return Promise.resolve(installCodex(env, dryRun));
  },

  uninstall(env: AdapterEnv) {
    return Promise.resolve(uninstallCodex(env));
  },

  doctor(env: AdapterEnv) {
    return Promise.resolve(doctorCodex(env));
  },
};
