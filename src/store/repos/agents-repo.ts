import type { Db } from "../db.js";
import { parseOptionalRow, parseRows } from "../parse.js";
import { agentRowSchema, type AgentRow } from "../schema.js";

export interface UpsertAgentInput {
  id: string;
  harness: string;
  folder: string;
  repoRoot: string;
  nativeSession: string | null;
  lastHeartbeat: number | null;
  createdAt: number;
}

export function upsertAgent(db: Db, input: UpsertAgentInput): AgentRow {
  db.prepare(
    `INSERT INTO agents(id, harness, folder, repo_root, native_session, last_heartbeat, created_at)
     VALUES (@id, @harness, @folder, @repoRoot, @nativeSession, @lastHeartbeat, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       harness = excluded.harness,
       folder = excluded.folder,
       repo_root = excluded.repo_root,
       native_session = excluded.native_session,
       last_heartbeat = excluded.last_heartbeat`,
  ).run(input);
  return getAgent(db, input.id);
}

export function getAgent(db: Db, id: string): AgentRow {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  const parsed = parseOptionalRow(agentRowSchema, row);
  if (!parsed) {
    throw new Error(`agent not found: ${id}`);
  }
  return parsed;
}

export function findAgent(db: Db, id: string): AgentRow | undefined {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  return parseOptionalRow(agentRowSchema, row);
}

export function listAgentsByRepo(db: Db, repoRoot: string): AgentRow[] {
  const rows = db
    .prepare("SELECT * FROM agents WHERE repo_root = ? ORDER BY id")
    .all(repoRoot);
  return parseRows(agentRowSchema, rows);
}

export function updateHeartbeat(
  db: Db,
  id: string,
  heartbeat: number,
  nativeSession: string | null,
): void {
  db.prepare(
    "UPDATE agents SET last_heartbeat = ?, native_session = ? WHERE id = ?",
  ).run(heartbeat, nativeSession, id);
}

/**
 * The agent a harness session registered as (latest heartbeat wins). Identity
 * follows the session, not the current folder: a session that `cd`s elsewhere
 * keeps the agent id it registered with at SessionStart.
 */
export function findAgentBySession(db: Db, nativeSession: string): AgentRow | undefined {
  const row = db
    .prepare(
      "SELECT * FROM agents WHERE native_session = ? ORDER BY last_heartbeat DESC LIMIT 1",
    )
    .get(nativeSession);
  return parseOptionalRow(agentRowSchema, row);
}

/** Refresh liveness only, leaving the owning session untouched (monitor polls). */
export function touchLiveness(db: Db, id: string, heartbeat: number): void {
  db.prepare("UPDATE agents SET last_heartbeat = ? WHERE id = ?").run(heartbeat, id);
}
