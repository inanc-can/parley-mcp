import type { Db } from "../db.js";
import { parseOptionalRow, parseRows } from "../parse.js";
import { claimRowSchema, type ClaimRow } from "../schema.js";

export interface InsertClaimInput {
  id: string;
  repoRoot: string;
  agentId: string;
  pathGlob: string;
  expiresAt: number;
}

export function insertClaim(db: Db, input: InsertClaimInput): ClaimRow {
  db.prepare(
    `INSERT INTO claims(id, repo_root, agent_id, path_glob, expires_at, released_at)
     VALUES (@id, @repoRoot, @agentId, @pathGlob, @expiresAt, NULL)`,
  ).run(input);
  return getClaim(db, input.id);
}

export function getClaim(db: Db, id: string): ClaimRow {
  const row = db.prepare("SELECT * FROM claims WHERE id = ?").get(id);
  const parsed = parseOptionalRow(claimRowSchema, row);
  if (!parsed) {
    throw new Error(`claim not found: ${id}`);
  }
  return parsed;
}

export function findClaim(db: Db, id: string): ClaimRow | undefined {
  const row = db.prepare("SELECT * FROM claims WHERE id = ?").get(id);
  return parseOptionalRow(claimRowSchema, row);
}

export function renewClaim(db: Db, id: string, expiresAt: number): boolean {
  const info = db
    .prepare(
      "UPDATE claims SET expires_at = ? WHERE id = ? AND released_at IS NULL",
    )
    .run(expiresAt, id);
  return info.changes === 1;
}

export function releaseClaim(db: Db, id: string, releasedAt: number): boolean {
  const info = db
    .prepare(
      "UPDATE claims SET released_at = ? WHERE id = ? AND released_at IS NULL",
    )
    .run(releasedAt, id);
  return info.changes === 1;
}

export function listActiveClaims(
  db: Db,
  repoRoot: string,
  now: number,
): ClaimRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM claims
       WHERE repo_root = ? AND released_at IS NULL AND expires_at > ?
       ORDER BY expires_at, id`,
    )
    .all(repoRoot, now);
  return parseRows(claimRowSchema, rows);
}

export function deleteClaimsOlderThan(
  db: Db,
  repoRoot: string,
  before: number,
): number {
  // claims older than retention window (by expiry/release context?) - delete old claims
  const info = db
    .prepare("DELETE FROM claims WHERE repo_root = ? AND expires_at < ?")
    .run(repoRoot, before);
  return info.changes;
}
