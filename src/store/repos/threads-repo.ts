import { z } from "zod";
import type { Db } from "../db.js";
import { parseOptionalRow, parseRows } from "../parse.js";
import { threadRowSchema, type ThreadRow, type ThreadStatus } from "../schema.js";

const countRow = z.object({ count: z.number().int().nonnegative() });

export interface CreateThreadInput {
  id: string;
  repoRoot: string;
  title: string | null;
  status: ThreadStatus;
  messageCap: number;
  createdAt: number;
}

export function createThread(db: Db, input: CreateThreadInput): ThreadRow {
  db.prepare(
    `INSERT INTO threads(id, repo_root, title, status, message_cap, created_at)
     VALUES (@id, @repoRoot, @title, @status, @messageCap, @createdAt)`,
  ).run(input);
  return getThread(db, input.id);
}

export function getThread(db: Db, id: string): ThreadRow {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
  const parsed = parseOptionalRow(threadRowSchema, row);
  if (!parsed) {
    throw new Error(`thread not found: ${id}`);
  }
  return parsed;
}

export function findThread(db: Db, id: string): ThreadRow | undefined {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
  return parseOptionalRow(threadRowSchema, row);
}

export function listThreadsByRepo(db: Db, repoRoot: string): ThreadRow[] {
  const rows = db
    .prepare("SELECT * FROM threads WHERE repo_root = ? ORDER BY created_at DESC")
    .all(repoRoot);
  return parseRows(threadRowSchema, rows);
}

export function setThreadStatus(db: Db, id: string, status: ThreadStatus): void {
  db.prepare("UPDATE threads SET status = ? WHERE id = ?").run(status, id);
}

export function countThreadMessages(db: Db, threadId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?")
    .get(threadId);
  return countRow.parse(row).count;
}

export function addThreadCap(db: Db, id: string, add: number): void {
  db.prepare("UPDATE threads SET message_cap = message_cap + ? WHERE id = ?").run(
    add,
    id,
  );
}
