import type { ThreadRow } from "../store/schema.js";

export const DEFAULT_MESSAGE_CAP = 20;
export const CAP_INCREASE = 20;

export type PostCheck =
  | { ok: true }
  | { ok: false; code: "thread_paused" | "thread_closed" };

export function checkThreadPostable(thread: ThreadRow, messageCount: number): PostCheck {
  if (thread.status === "closed") {
    return { ok: false, code: "thread_closed" };
  }
  if (thread.status === "paused") {
    return { ok: false, code: "thread_paused" };
  }
  if (messageCount >= thread.message_cap) {
    return { ok: false, code: "thread_paused" };
  }
  return { ok: true };
}

export function shouldPauseAfterCount(messageCount: number, cap: number): boolean {
  return messageCount >= cap;
}

/**
 * Threads get their title from the first message, trimmed to one short line
 * for the viewer's thread list.
 */
export function titleFromFirstMessage(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

export const MAX_TITLE_LENGTH = 60;
