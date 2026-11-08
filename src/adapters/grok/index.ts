import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterEnv, DetectReport } from "../types.js";
import { GROK_DIR_REL } from "./config-files.js";
import { doctorGrok, installGrok, uninstallGrok } from "./install.js";

/**
 * The Grok Build adapter (PLAN section 6 "Grok Build"): MCP server in
 * ~/.grok/config.toml, hooks in ~/.grok/hooks/mcp-parley.json, and a skill
 * that asks the agent to keep one persistent `monitor` on `inbox watch`, which
 * is what wakes an idle session. Grok Bot on grok.com is out of scope (v1).
 */
export const grokAdapter: Adapter = {
  harness: "grok",
  detect(env: AdapterEnv): Promise<DetectReport> {
    return Promise.resolve({ installed: existsSync(join(env.home, GROK_DIR_REL)) });
  },
  install(env: AdapterEnv, dryRun: boolean) {
    return Promise.resolve(installGrok(env, dryRun));
  },
  uninstall(env: AdapterEnv) {
    return Promise.resolve(uninstallGrok(env));
  },
  doctor(env: AdapterEnv) {
    return Promise.resolve(doctorGrok(env));
  },
};
