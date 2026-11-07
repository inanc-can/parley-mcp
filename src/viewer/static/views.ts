import { array, boolean, enum as zEnum, nullable, number, object, optional, string, type infer as Infer } from "zod/mini";

/** Response shapes from the viewer API (mirrors src/viewer/api-read.ts), parsed at the edge. */

const messageStatus = zEnum(["sent", "delivered", "read", "replied", "failed"]);

export const threadSummarySchema = object({
  id: string(),
  title: string(),
  status: zEnum(["open", "paused", "closed"]),
  messageCount: number(),
  messageCap: number(),
  estTokens: number(),
  lastMessage: nullable(object({ from: string(), preview: string(), status: messageStatus, at: number() })),
});
export type ThreadSummary = Infer<typeof threadSummarySchema>;

export const stateSchema = object({
  repoRoot: string(),
  stopAll: boolean(),
  agents: array(object({ id: string(), harness: string(), alive: boolean(), lastSeen: nullable(number()) })),
  threads: array(threadSummarySchema),
});
export type State = Infer<typeof stateSchema>;

export const messageSchema = object({
  id: string(),
  from: string(),
  to: string(),
  kind: string(),
  body: string(),
  replyTo: nullable(string()),
  status: messageStatus,
  sentAt: number(),
  deliveredAt: nullable(number()),
  readAt: nullable(number()),
  repliedAt: nullable(number()),
  failedAt: nullable(number()),
  estTokens: number(),
});
export type Message = Infer<typeof messageSchema>;

export const agreementSchema = object({
  id: string(),
  text: string(),
  status: zEnum(["offered", "accepted", "countered", "rejected", "vetoed"]),
  offeredBy: string(),
  offeredTo: string(),
  answeredBy: nullable(string()),
  createdAt: number(),
  answeredAt: nullable(number()),
  parentId: nullable(string()),
});
export type Agreement = Infer<typeof agreementSchema>;

export const threadViewSchema = object({
  thread: threadSummarySchema,
  messages: array(messageSchema),
  agreements: array(agreementSchema),
});
export type ThreadView = Infer<typeof threadViewSchema>;

export const errorSchema = object({ error: string(), detail: optional(string()) });

/**
 * One message the human or an agent sent to several recipients is stored as one
 * row per recipient. Group them back into one bubble with a receipt per recipient.
 */
export interface MessageGroup {
  key: string;
  from: string;
  body: string;
  sentAt: number;
  estTokens: number;
  rows: Message[];
}

export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const byKey = new Map<string, MessageGroup>();
  for (const m of messages) {
    const key = `${m.from}\u0000${String(m.sentAt)}\u0000${m.body}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.rows.push(m);
      continue;
    }
    const group: MessageGroup = { key, from: m.from, body: m.body, sentAt: m.sentAt, estTokens: m.estTokens, rows: [m] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
}

/** The receipt label PLAN's viewer shows: ✓ sent, ✓✓ delivered, read, replied, failed. */
export function receiptLabel(status: Message["status"]): string {
  switch (status) {
    case "sent":
      return "✓ sent";
    case "delivered":
      return "✓✓ delivered";
    case "read":
      return "✓✓ read";
    case "replied":
      return "↩ replied";
    case "failed":
      return "✗ failed";
  }
}
