import { serve, type ServeHandle, type ServeOptions } from "../../mcp/server.js";
import { AGENT_ID_ENV } from "../../mcp/identity.js";
import { resolveDbPath, resolveRepoRoot } from "../context.js";

export interface ServeCommandDeps {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Injected in tests to observe the resolved options without real stdio. */
  start?: (options: ServeOptions) => Promise<ServeHandle>;
}

/**
 * `parley-mcp serve`: start the MCP server over stdio (PLAN section 7).
 * Harnesses launch this; it resolves the repo root (git top level), the hub db
 * path, and the agent id from the environment, then hands off to the M2
 * `serve()` entry point.
 */
export async function runServe(deps: ServeCommandDeps = {}): Promise<ServeHandle> {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const start = deps.start ?? serve;
  const options: ServeOptions = {
    agentIdEnv: env[AGENT_ID_ENV],
    repoRoot: resolveRepoRoot(cwd),
    dbPath: resolveDbPath(env),
  };
  return start(options);
}
