import { isAlive } from "../../core/identity.js";
import { agentsRepo, type Db } from "../../store/index.js";

export interface WhoDeps {
  db: Db;
  repoRoot: string;
  write: (line: string) => void;
  now?: number;
}

/**
 * `mcp-parley who`: the agents in this repo, each marked alive (heartbeat in
 * the last 30 s) or idle (PLAN section 7 / presence).
 */
export function runWho(deps: WhoDeps): void {
  const now = deps.now ?? Date.now();
  const agents = agentsRepo.listAgentsByRepo(deps.db, deps.repoRoot);
  if (agents.length === 0) {
    deps.write("No agents in this repo yet.");
    return;
  }
  deps.write(`Agents in ${deps.repoRoot}:`);
  for (const agent of agents) {
    const state = isAlive(agent.last_heartbeat, now) ? "alive" : "idle";
    deps.write(`  ${agent.id}  [${state}]  (${agent.harness})`);
  }
}
