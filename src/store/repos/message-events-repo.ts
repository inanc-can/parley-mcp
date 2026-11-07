import type { Db } from "../db.js";
import { parseRows } from "../parse.js";
import { messageEventRowSchema, type MessageEventRow } from "../schema.js";

export interface InsertMessageEventInput {
  id: string;
  messageId: string;
  event: string;
  at: number;
  detailJson: string | null;
}

export function insertMessageEvent(db: Db, input: InsertMessageEventInput): void {
  db.prepare(
    `INSERT INTO message_events(id, message_id, event, at, detail_json)
     VALUES (@id, @messageId, @event, @at, @detailJson)`,
  ).run(input);
}

export function listMessageEvents(db: Db, messageId: string): MessageEventRow[] {
  const rows = db
    .prepare("SELECT * FROM message_events WHERE message_id = ? ORDER BY at, id")
    .all(messageId);
  return parseRows(messageEventRowSchema, rows);
}

export function deleteEventsOlderThan(db: Db, before: number): number {
  const info = db.prepare("DELETE FROM message_events WHERE at < ?").run(before);
  return info.changes;
}
