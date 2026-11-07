import type { MessageStatus } from "../store/schema.js";

const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  sent: ["delivered", "failed"],
  delivered: ["read"],
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
