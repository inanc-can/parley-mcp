import { serve, type ServeHandle, type ServeOptions } from "../../mcp/server.js";
import { AGENT_ID_ENV } from "../../mcp/identity.js";
import { resolveDbPath, resolveRepoRoot } from "../context.js";
import { homedir } from "node:os";
import { spawnCodexWake } from "../../adapters/codex/spawn-wake.js";
import { osNotifier } from "../../notify/os-notify.js";

/** How long a talk-started Codex wake waits for a busy turn to end. */
const TALK_WAKE_WAIT_S = 60;

export interface ServeCommandDeps {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Injected in tests to observe the resolved options without real stdio. */
  start?: (options: ServeOptions) => Promise<ServeHandle>;
}

/**
 * `mcp-parley serve`: start the MCP server over stdio (PLAN section 7).
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
    cwd,
    sessionId: env["CLAUDE_CODE_SESSION_ID"],
    dbPath: resolveDbPath(env),
    wakeRecipient: codexWaker(env["HOME"] ?? homedir()),
    notify: osNotifier({ env }),
  };
  return start(options);
}

/** Codex recipients are woken through the app-server daemon (M5); others need no out-of-band wake. */
function codexWaker(home: string): (agentId: string, harness: string) => boolean {
  const spawnWake = spawnCodexWake(home);
  return (agentId, harness) => harness === "codex" && spawnWake(agentId, TALK_WAKE_WAIT_S);
}
