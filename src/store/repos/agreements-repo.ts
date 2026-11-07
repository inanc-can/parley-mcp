import type { Db } from "../db.js";
import { parseOptionalRow, parseRows } from "../parse.js";
import {
  agreementRowSchema,
  type AgreementRow,
  type AgreementStatus,
} from "../schema.js";

export interface InsertAgreementInput {
  id: string;
  threadId: string;
  repoRoot: string;
  text: string;
  status: AgreementStatus;
  offeredBy: string;
  answeredBy: string | null;
  parentId: string | null;
  createdAt: number;
  answeredAt: number | null;
}

export function insertAgreement(db: Db, input: InsertAgreementInput): AgreementRow {
  db.prepare(
    `INSERT INTO agreements(id, thread_id, repo_root, text, status, offered_by, answered_by, parent_id, created_at, answered_at)
     VALUES (@id, @threadId, @repoRoot, @text, @status, @offeredBy, @answeredBy, @parentId, @createdAt, @answeredAt)`,
  ).run(input);
  return getAgreement(db, input.id);
}

export function getAgreement(db: Db, id: string): AgreementRow {
  const row = db.prepare("SELECT * FROM agreements WHERE id = ?").get(id);
  const parsed = parseOptionalRow(agreementRowSchema, row);
  if (!parsed) {
    throw new Error(`agreement not found: ${id}`);
  }
  return parsed;
}

export function findAgreement(db: Db, id: string): AgreementRow | undefined {
  const row = db.prepare("SELECT * FROM agreements WHERE id = ?").get(id);
  return parseOptionalRow(agreementRowSchema, row);
}

export function updateAgreementStatus(
  db: Db,
  id: string,
  status: AgreementStatus,
  answeredBy: string | null,
  answeredAt: number | null,
): void {
  db.prepare(
    "UPDATE agreements SET status = ?, answered_by = ?, answered_at = ? WHERE id = ?",
  ).run(status, answeredBy, answeredAt, id);
}

export function listAgreementsByRepo(db: Db, repoRoot: string): AgreementRow[] {
  const rows = db
    .prepare(
      "SELECT * FROM agreements WHERE repo_root = ? ORDER BY created_at DESC, id",
    )
    .all(repoRoot);
  return parseRows(agreementRowSchema, rows);
}

export function deleteAgreementsOlderThan(db: Db, before: number): number {
  const info = db
    .prepare("DELETE FROM agreements WHERE created_at < ?")
    .run(before);
  return info.changes;
}
