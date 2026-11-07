import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAlive } from "../../core/identity.js";
import { heartbeatCaller } from "../identity.js";
import type { ToolContext } from "../context.js";
import { success, refused, type ToolOutcome } from "../response.js";
import { readRulesFile, rulesReminder } from "../rules.js";
import {
  agentsRepo,
  agreementsRepo,
  messageEventsRepo,
  messagesRepo,
  threadsRepo,
  type AgentRow,
  type AgreementRow,
  type MessageRow,
} from "../../store/index.js";

export const inboxArgsShape = {
  thread_id: z.string().min(1).optional(),
  include_sent: z.boolean().optional(),
  include_decisions: z.boolean().optional(),
  who: z.boolean().optional(),
} as const;

export type InboxArgs = z.output<z.ZodObject<typeof inboxArgsShape>>;

export function handleInbox(
  ctx: ToolContext,
  args: InboxArgs,
  now: number = Date.now(),
): ToolOutcome {
  const { db, agentId } = ctx;
  heartbeatCaller(db, agentId, ctx.nativeSession, now);

  const threadOutcome = resolveThreadFilter(ctx, args.thread_id);
  if (!threadOutcome.ok) {
    return refused(threadOutcome.errorCode, threadOutcome.detail);
  }

  const mine = readIncoming(ctx, threadOutcome.threadId, now);

  const parts: string[] = [
    `${String(mine.length)} message(s) returned and marked as read (a reply also marks them read).`,
  ];

  const value: {
    messages: ReturnType<typeof serializeMessage>[];
    sent_receipts?: Record<string, unknown>[];
    decisions?: Record<string, unknown>[];
    agents?: Record<string, unknown>[];
    rules_text?: string;
  } = { messages: mine };

  if (args.include_sent === true) {
    const receipts = listOutgoingReceipts(ctx, threadOutcome.threadId);
    value.sent_receipts = receipts;
    parts.push(`Included ${String(receipts.length)} sent receipt(s).`);
  }
  if (args.include_decisions === true) {
    const decisions = listDecisions(ctx);
    value.decisions = decisions;
    parts.push(`Included ${String(decisions.length)} accepted decision(s).`);
  }
  if (args.who === true) {
    const agents = listWho(ctx, now);
    value.agents = agents;
    parts.push(
      `Agents: ${agents
        .map((agent) => `${String(agent["id"])} (${agent["alive"] === true ? "alive" : "idle"})`)
        .join(", ")}.`,
    );
  }

  const rules = readRulesFile(ctx.repoRoot);
  const reminder = rulesReminder(rules);
  if (reminder !== null) {
    parts.push(reminder);
    if (!ctx.rulesTextSent && rules.text !== null) {
      value.rules_text = rules.text;
      ctx.rulesTextSent = true;
      parts.push("The rules text is in rules_text (sent once per session).");
    }
  }

  return success(value, parts.join(" "));
}

type ThreadFilterOutcome =
  | { ok: true; threadId: string | null }
  | { ok: false; errorCode: string; detail: string };

function resolveThreadFilter(
  ctx: ToolContext,
  threadId: string | undefined,
): ThreadFilterOutcome {
  if (threadId === undefined) {
    return { ok: true, threadId: null };
  }
  const thread = threadsRepo.findThread(ctx.db, threadId);
  if (thread === undefined) {
    return {
      ok: false,
      errorCode: "thread_not_found",
      detail: `No thread ${threadId} in this hub.`,
    };
  }
  return { ok: true, threadId };
}

/**
 * Returns the messages addressed to the caller (optionally in one thread) and
 * marks each returned message read. Read needs evidence: the recipient calling
 * `inbox` is that evidence (PLAN 4.3). A queued message is first delivered to
 * this session (it is being read right now), then read.
 */
function readIncoming(
  ctx: ToolContext,
  threadId: string | null,
  now: number,
): ReturnType<typeof serializeMessage>[] {
  const pending =
    threadId === null
      ? messagesRepo.listUndeliveredForRecipient(ctx.db, ctx.agentId, now)
      : messagesRepo
          .listThreadMessages(ctx.db, threadId)
          .filter((message: MessageRow) => message.to_agent === ctx.agentId);

  const serialized = pending.map((message) => {
    const progressed =
      progressStatus(ctx, message, now, "delivered") &&
      progressStatus(ctx, message, now, "read");
    let current: MessageRow = message;
    if (progressed) {
      current = messagesRepo.getMessage(ctx.db, message.id);
    }
    return serializeMessage(current);
  });
  return serialized;
}

/**
 * Moves a message to `to` when the state machine allows it, records the event
 * for the viewer, and reports whether it moved.
 */
function progressStatus(
  ctx: ToolContext,
  message: MessageRow,
  now: number,
  to: "delivered" | "read",
): boolean {
  const moved = messagesRepo.guardedStatusUpdate(ctx.db, message.id, {
    status: to,
    at: now,
    deliveredSession: ctx.nativeSession,
  });
  if (moved) {
    messageEventsRepo.insertMessageEvent(ctx.db, {
      id: randomUUID(),
      messageId: message.id,
      event: to,
      at: now,
      detailJson: null,
    });
  }
  return moved;
}

function serializeMessage(message: MessageRow): Record<string, unknown> {
  return {
    message_id: message.id,
    thread_id: message.thread_id,
    from_agent: message.from_agent,
    kind: message.kind,
    body: message.body,
    status: message.status,
    sent_at: message.sent_at,
    reply_to: message.reply_to,
  };
}

function listOutgoingReceipts(
  ctx: ToolContext,
  threadId: string | null,
): Record<string, unknown>[] {
  const mine =
    threadId === null
      ? messagesRepo.listMessagesFromAgent(ctx.db, ctx.agentId)
      : messagesRepo
          .listThreadMessages(ctx.db, threadId)
          .filter((message: MessageRow) => message.from_agent === ctx.agentId);
  return mine
    .map((message: MessageRow) => ({
      message_id: message.id,
      thread_id: message.thread_id,
      to_agent: message.to_agent,
      status: message.status,
      sent_at: message.sent_at,
      delivered_at: message.delivered_at,
      read_at: message.read_at,
      replied_at: message.replied_at,
    }));
}

function listDecisions(ctx: ToolContext): Record<string, unknown>[] {
  return agreementsRepo
    .listAgreementsByRepo(ctx.db, ctx.repoRoot)
    .filter((agreement: AgreementRow) => agreement.status === "accepted")
    .map((agreement) => ({
      agreement_id: agreement.id,
      thread_id: agreement.thread_id,
      text: agreement.text,
      offered_by: agreement.offered_by,
      answered_by: agreement.answered_by,
      created_at: agreement.created_at,
      answered_at: agreement.answered_at,
    }));
}

function listWho(ctx: ToolContext, now: number): Record<string, unknown>[] {
  return agentsRepo
    .listAgentsByRepo(ctx.db, ctx.repoRoot)
    .map((agent: AgentRow) => ({
      id: agent.id,
      alive: isAlive(agent.last_heartbeat, now),
      last_heartbeat: agent.last_heartbeat,
    }));
}
