import type { MessageStatus } from "../store/schema.js";

export const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  sent: ["delivered", "failed"],
  // A reply counts as read evidence (PLAN 4.3), so delivered may jump to
  // replied; the store sets read_at when it does.
  delivered: ["read", "replied"],
  read: ["replied"],
  replied: [],
  failed: [],
};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedFromStatuses(to: MessageStatus): MessageStatus[] {
  const result: MessageStatus[] = [];
  const statuses: MessageStatus[] = [
    "sent",
    "delivered",
    "read",
    "replied",
    "failed",
  ];
  for (const from of statuses) {
    if (canTransition(from, to)) {
      result.push(from);
    }
  }
  return result;
}

export interface FanoutRecipient {
  toAgent: string;
  idempotencyKey: string;
}

export function expandEveryone(
  recipientIds: readonly string[],
  fromAgent: string,
  idempotencyKey: string,
): FanoutRecipient[] {
  const result: FanoutRecipient[] = [];
  for (const id of recipientIds) {
    if (id === fromAgent) {
      continue;
    }
    result.push({
      toAgent: id,
      idempotencyKey: `${idempotencyKey}::${id}`,
    });
  }
  return result;
}
