import { basename } from "node:path";
import { parseAgentId } from "../core/identity.js";
import type { AgentRow } from "../store/schema.js";
import {
  agentsRepo,
  type Db,
} from "../store/index.js";

export const AGENT_ID_ENV = "PARLEY_AGENT_ID";
export const HARNESS_ENV = "PARLEY_HARNESS";

/**
 * The calling agent of a per-session MCP server. Adapters (M4+) set
 * `PARLEY_AGENT_ID` when launching the harness's server; without it the
 * server derives `harness@folder` from the folder name (harness name from
 * `PARLEY_HARNESS`, else `mcp`). This is M2 scaffolding for real adapters.
 */
export function resolveAgentId(agentIdEnv: string | undefined, cwd: string): string {
  if (agentIdEnv !== undefined && agentIdEnv.length > 0) {
    const identity = parseAgentId(agentIdEnv);
    if (identity === null) {
      throw new Error(`invalid ${AGENT_ID_ENV}: ${agentIdEnv}`);
    }
    return agentIdEnv;
  }
  const harness = process.env[HARNESS_ENV] ?? "mcp";
  return `${harness}@${basename(cwd)}`;
}

/** Register the caller (idempotent) and stamp a heartbeat for this call. */
export function registerCaller(
  db: Db,
  agentId: string,
  repoRoot: string,
  nativeSession: string | null,
  now: number,
): AgentRow {
  const identity = parseAgentId(agentId);
  if (identity === null) {
    throw new Error(`invalid agent id: ${agentId}`);
  }
  return agentsRepo.upsertAgent(db, {
    id: agentId,
    harness: identity.harness,
    folder: identity.folder,
    repoRoot,
    nativeSession,
    lastHeartbeat: now,
    createdAt: now,
  });
}

/**
 * Refresh the calling agent's heartbeat on every tool call. A server that does
 * not know its harness session (Codex gives MCP servers no session id) only
 * touches liveness: writing a null session would erase the thread id the
 * Codex SessionStart hook recorded, which the idle wake targets.
 */
export function heartbeatCaller(
  db: Db,
  agentId: string,
  nativeSession: string | null,
  now: number,
): void {
  if (nativeSession === null) {
    agentsRepo.touchLiveness(db, agentId, now);
    return;
  }
  agentsRepo.updateHeartbeat(db, agentId, now, nativeSession);
}
