import type { Db } from "../db.js";
import { parseRows } from "../parse.js";
import { editRowSchema, type EditRow } from "../schema.js";

export interface InsertEditInput {
  id: string;
  repoRoot: string;
  agentId: string;
  path: string;
  at: number;
}

export function insertEdit(db: Db, input: InsertEditInput): void {
  db.prepare(
    `INSERT INTO edits(id, repo_root, agent_id, path, at)
     VALUES (@id, @repoRoot, @agentId, @path, @at)`,
  ).run(input);
}

export function listRecentEditsForPath(
  db: Db,
  repoRoot: string,
  path: string,
  since: number,
): EditRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM edits
       WHERE repo_root = ? AND path = ? AND at >= ?
       ORDER BY at, id`,
    )
    .all(repoRoot, path, since);
  return parseRows(editRowSchema, rows);
}

export function deleteEditsOlderThan(db: Db, before: number): number {
  const info = db.prepare("DELETE FROM edits WHERE at < ?").run(before);
  return info.changes;
}
