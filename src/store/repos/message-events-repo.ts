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

export function deleteEventsOfMessagesSentBefore(db: Db, before: number): number {
  // Delete every event of messages being removed, including events that are
  // newer than the cutoff (e.g. a recent expiry event on an old message);
  // otherwise the FK to the deleted message breaks during retention.
  const info = db
    .prepare(
      `DELETE FROM message_events
       WHERE message_id IN (SELECT id FROM messages WHERE sent_at < ?)`,
    )
    .run(before);
  return info.changes;
}
