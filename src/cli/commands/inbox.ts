import { randomUUID } from "node:crypto";
import { parseAgentId } from "../../core/identity.js";
import {
  agentsRepo,
  messageEventsRepo,
  messagesRepo,
  type Db,
  type MessageRow,
} from "../../store/index.js";

export type DrainFormat = "monitor" | "json";

export interface InboxDeps {
  db: Db;
  repoRoot: string;
  write: (line: string) => void;
  now?: number;
}

/**
 * `parley-mcp inbox drain --agent <id> [--format monitor|json]`: used by
 * adapters. Reads the agent's pending (sent, unexpired) messages, marks each
 * `delivered` (stamping a delivered event + the delivering session), and
 * prints one line per message. Delivery alone never marks a message `read`;
 * read needs its own evidence (PLAN 4.3). Returns the number drained.
 */
export function runInboxDrain(
  deps: InboxDeps,
  agentId: string,
  format: DrainFormat,
  session: string | null,
): number {
  const now = deps.now ?? Date.now();
  const pending = messagesRepo.listUndeliveredForRecipient(deps.db, agentId, now);
  for (const message of pending) {
    deliverMessage(deps.db, message, now, session);
    deps.write(formatDrainLine(message, format));
  }
  return pending.length;
}

function deliverMessage(db: Db, message: MessageRow, now: number, session: string | null): void {
  const moved = messagesRepo.guardedStatusUpdate(db, message.id, {
    status: "delivered",
    at: now,
    deliveredSession: session,
  });
  if (moved) {
    messageEventsRepo.insertMessageEvent(db, {
      id: randomUUID(),
      messageId: message.id,
      event: "delivered",
      at: now,
      detailJson: null,
    });
  }
}

function formatDrainLine(message: MessageRow, format: DrainFormat): string {
  if (format === "json") {
    return JSON.stringify({
      message_id: message.id,
      thread_id: message.thread_id,
      from_agent: message.from_agent,
      kind: message.kind,
      body: message.body,
    });
  }
  // monitor: one short, notification-friendly line (PLAN section 6).
  return `parley: ${message.from_agent} — ${message.body}`;
}

/**
 * `parley-mcp inbox register --agent <id> [--session <native>]`: used by
 * adapters on session start to create/refresh the agent and stamp a heartbeat.
 */
export function runInboxRegister(deps: InboxDeps, agentId: string, session: string | null): void {
  const now = deps.now ?? Date.now();
  const identity = parseAgentId(agentId);
  if (identity === null) {
    throw new Error(`invalid agent id: ${agentId}`);
  }
  agentsRepo.upsertAgent(deps.db, {
    id: agentId,
    harness: identity.harness,
    folder: identity.folder,
    repoRoot: deps.repoRoot,
    nativeSession: session,
    lastHeartbeat: now,
    createdAt: now,
  });
  deps.write(`registered ${agentId} in ${deps.repoRoot}`);
}

export interface WatchResult {
  found: boolean;
}

/**
 * One pass of `parley-mcp inbox watch --agent <id> --once`: the adapters use a
 * long-running watcher that waits for a single message, prints it and exits so
 * the harness resumes the agent (PLAN section 6, Cursor/Grok). This core step
 * drains at most one message and reports whether one was found; the loop and
 * the polling delay live in the command wiring so the pure step stays testable.
 */
export function runInboxWatchOnce(
  deps: InboxDeps,
  agentId: string,
  format: DrainFormat,
  session: string | null,
): WatchResult {
  const now = deps.now ?? Date.now();
  const pending = messagesRepo.listUndeliveredForRecipient(deps.db, agentId, now);
  const first = pending[0];
  if (first === undefined) {
    return { found: false };
  }
  deliverMessage(deps.db, first, now, session);
  deps.write(formatDrainLine(first, format));
  return { found: true };
}
