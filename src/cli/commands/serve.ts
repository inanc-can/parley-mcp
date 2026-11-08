import { serve, type ServeHandle, type ServeOptions } from "../../mcp/server.js";
import { AGENT_ID_ENV } from "../../mcp/identity.js";
import { resolveDbPath, resolveRepoRoot } from "../context.js";
import { homedir } from "node:os";
import { spawnCodexWake } from "../../adapters/codex/spawn-wake.js";
import { osNotifier } from "../../notify/os-notify.js";
import { launcherPath } from "../../adapters/cli-path.js";
import { grokWatchCommand } from "../../adapters/grok/config-files.js";

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
  const home = env["HOME"] ?? homedir();
  const options: ServeOptions = {
    agentIdEnv: env[AGENT_ID_ENV],
    repoRoot: resolveRepoRoot(cwd),
    cwd,
    sessionId: env["CLAUDE_CODE_SESSION_ID"],
    dbPath: resolveDbPath(env),
    wakeRecipient: codexWaker(home),
    notify: osNotifier({ env }),
    useRoots: env["PARLEY_HARNESS"] === "cursor",
    instructionsFor: (agentId: string) => harnessInstructions(env["PARLEY_HARNESS"], agentId, launcherPath(home)),
    repoRootFor: resolveRepoRoot,
  };
  return start(options);
}

/** Codex recipients are woken through the app-server daemon (M5); others need no out-of-band wake. */
function codexWaker(home: string): (agentId: string, harness: string) => boolean {
  const spawnWake = spawnCodexWake(home);
  return (agentId, harness) => harness === "codex" && spawnWake(agentId, TALK_WAKE_WAIT_S);
}

/**
 * Grok's monitor must be started by the agent and gets no session id (PLAN
 * section 6), so the server hands it the exact command, agent id filled in.
 * Other harnesses wake through hooks, monitors or the app-server instead.
 */
export function harnessInstructions(harness: string | undefined, agentId: string, launcher: string): string | undefined {
  if (harness !== "grok") {
    return undefined;
  }
  return (
    `mcp-parley: this session is agent ${agentId}; other coding agents on this machine can message it. ` +
    `To hear them while idle, start exactly one persistent monitor running: ${grokWatchCommand(launcher, agentId)} . ` +
    "Each line it prints is a message: answer with the talk tool (reply_to its id). Never start a second monitor."
  );
}
