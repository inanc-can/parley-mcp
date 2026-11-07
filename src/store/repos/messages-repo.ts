import type { Db } from "../db.js";
import { parseOptionalRow, parseRows } from "../parse.js";
import {
  messageRowSchema,
  type MessageKind,
  type MessageRow,
  type MessageStatus,
} from "../schema.js";

export interface InsertMessageInput {
  id: string;
  threadId: string;
  fromAgent: string;
  toAgent: string;
  kind: MessageKind;
  body: string;
  payloadJson: string | null;
  replyTo: string | null;
  status: MessageStatus;
  sentAt: number;
  expiresAt: number;
  idempotencyKey: string;
  estTokens: number;
}

const INSERT_MESSAGE_SQL = `INSERT INTO messages(
  id, thread_id, from_agent, to_agent, kind, body, payload_json, reply_to,
  status, error_code, sent_at, delivered_at, read_at, replied_at, failed_at,
  expires_at, delivered_session, idempotency_key, est_tokens
) VALUES (
  @id, @threadId, @fromAgent, @toAgent, @kind, @body, @payloadJson, @replyTo,
  @status, NULL, @sentAt, NULL, NULL, NULL, NULL,
  @expiresAt, NULL, @idempotencyKey, @estTokens
)`;

export function insertMessage(db: Db, input: InsertMessageInput): MessageRow {
  db.prepare(INSERT_MESSAGE_SQL).run(input);
  return getMessage(db, input.id);
}

export function insertMessageIdempotent(
  db: Db,
  input: InsertMessageInput,
): { message: MessageRow; created: boolean } {
  const run = db.transaction(() => {
    const existing = findByIdempotency(db, input.fromAgent, input.idempotencyKey);
    if (existing) {
      return { message: existing, created: false };
    }
    const info = db
      .prepare(
        `${INSERT_MESSAGE_SQL}
         ON CONFLICT(from_agent, idempotency_key) DO NOTHING`,
      )
      .run(input);
    if (info.changes === 0) {
      const raced = findByIdempotency(db, input.fromAgent, input.idempotencyKey);
      if (!raced) {
        throw new Error("idempotent insert conflict but row missing");
      }
      return { message: raced, created: false };
    }
    return { message: getMessage(db, input.id), created: true };
  });
  return run();
}

export function findByIdempotency(
  db: Db,
  fromAgent: string,
  idempotencyKey: string,
): MessageRow | undefined {
  const row = db
    .prepare(
      "SELECT * FROM messages WHERE from_agent = ? AND idempotency_key = ?",
    )
    .get(fromAgent, idempotencyKey);
  return parseOptionalRow(messageRowSchema, row);
}

export function getMessage(db: Db, id: string): MessageRow {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  const parsed = parseOptionalRow(messageRowSchema, row);
  if (!parsed) {
    throw new Error(`message not found: ${id}`);
  }
  return parsed;
}

export function findMessage(db: Db, id: string): MessageRow | undefined {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  return parseOptionalRow(messageRowSchema, row);
}

const ALLOWED_FROM: Record<MessageStatus, readonly MessageStatus[]> = {
  sent: [],
  delivered: ["sent"],
  read: ["delivered"],
  replied: ["read"],
  failed: ["sent"],
};

export interface GuardedStatusUpdate {
  status: MessageStatus;
  at: number;
  errorCode?: string | null;
  deliveredSession?: string | null;
}

export function guardedStatusUpdate(
  db: Db,
  id: string,
  update: GuardedStatusUpdate,
): boolean {
  const fromStatuses = ALLOWED_FROM[update.status];
  if (fromStatuses.length === 0) {
    return false;
  }
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const sets = ["status = ?"];
  const args: (string | number | null)[] = [update.status];
  if (update.status === "delivered") {
    sets.push("delivered_at = ?");
    args.push(update.at);
    sets.push("delivered_session = ?");
    args.push(update.deliveredSession ?? null);
  } else if (update.status === "read") {
    sets.push("read_at = ?");
    args.push(update.at);
  } else if (update.status === "replied") {
    sets.push("replied_at = ?");
    args.push(update.at);
  } else if (update.status === "failed") {
    sets.push("failed_at = ?");
    args.push(update.at);
    sets.push("error_code = ?");
    args.push(update.errorCode ?? null);
  }
  args.push(id);
  for (const from of fromStatuses) {
    args.push(from);
  }
  const info = db
    .prepare(
      `UPDATE messages SET ${sets.join(", ")} WHERE id = ? AND status IN (${placeholders})`,
    )
    .run(...args);
  return info.changes === 1;
}

export function requeueDeliveredForSession(
  db: Db,
  toAgent: string,
  exceptSession: string | null,
): number {
  let info;
  if (exceptSession === null) {
    info = db
      .prepare(
        `UPDATE messages SET status = 'sent', delivered_at = NULL, delivered_session = NULL
         WHERE to_agent = ? AND status = 'delivered'`,
      )
      .run(toAgent);
  } else {
    info = db
      .prepare(
        `UPDATE messages SET status = 'sent', delivered_at = NULL, delivered_session = NULL
         WHERE to_agent = ? AND status = 'delivered' AND (delivered_session IS NULL OR delivered_session != ?)`,
      )
      .run(toAgent, exceptSession);
  }
  return info.changes;
}

export function expireSentMessages(db: Db, now: number): number {
  const info = db
    .prepare(
      `UPDATE messages SET status = 'failed', failed_at = ?, error_code = 'expired'
       WHERE status = 'sent' AND expires_at <= ?`,
    )
    .run(now, now);
  return info.changes;
}

export function listUndeliveredForRecipient(
  db: Db,
  toAgent: string,
  now: number,
): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE to_agent = ? AND status = 'sent' AND expires_at > ?
       ORDER BY sent_at, id`,
    )
    .all(toAgent, now);
  return parseRows(messageRowSchema, rows);
}

export function listThreadMessages(db: Db, threadId: string): MessageRow[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY sent_at, id")
    .all(threadId);
  return parseRows(messageRowSchema, rows);
}

export function deleteMessagesOlderThan(db: Db, before: number): number {
  const info = db
    .prepare("DELETE FROM messages WHERE sent_at < ?")
    .run(before);
  return info.changes;
}
