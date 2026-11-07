import { randomUUID } from "node:crypto";
import { z } from "zod";
import { estimateTokens } from "../../core/cost.js";
import { scanSecret } from "../../core/guards.js";
import type { AgentRow } from "../../store/schema.js";
import { MESSAGE_TTL_MS, expandEveryone } from "../../core/message-rules.js";
import {
  DEFAULT_MESSAGE_CAP,
  checkThreadPostable,
  titleFromFirstMessage,
} from "../../core/threads.js";
import type { ToolContext } from "../context.js";
import { checkStopAllActive, enforceMessageCap } from "../guards.js";
import { heartbeatCaller } from "../identity.js";
import { pausedNotice } from "../../notify/os-notify.js";
import { buildOutlook, pluralOutlook } from "../outlook.js";
import { refused, success, type ToolOutcome } from "../response.js";
import { readRulesFile, rulesReminder } from "../rules.js";
import {
  agentsRepo,
  messageEventsRepo,
  messageKindSchema,
  messagesRepo,
  threadsRepo,
  type MessageRow,
  type ThreadRow,
} from "../../store/index.js";

export const talkArgsShape = {
  to: z.string().min(1),
  text: z.string().min(1),
  kind: messageKindSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  thread_id: z.string().min(1).optional(),
  reply_to: z.string().min(1).optional(),
  wait_for_reply_s: z.number().int().min(0).max(600).optional(),
  idempotency_key: z.string().min(1),
} as const;

export type TalkArgs = z.output<z.ZodObject<typeof talkArgsShape>>;

const POLL_INTERVAL_MS = 25;

interface FanoutEntry {
  toAgent: string;
  idempotencyKey: string;
}

interface Delivery {
  recipientId: string;
  message: MessageRow;
}

type ThreadOutcome =
  | { ok: true; thread: ThreadRow }
  | { ok: false; errorCode: string; detail: string };

export async function handleTalk(
  ctx: ToolContext,
  args: TalkArgs,
  now: number = Date.now(),
): Promise<ToolOutcome> {
  const { db, agentId } = ctx;
  heartbeatCaller(db, agentId, ctx.nativeSession, now);

  const stop = checkStopAllActive(db);
  if (!stop.ok) {
    return refused(
      "stop_all",
      "The human turned on stop-all; talk calls stay blocked until they turn it off in the viewer.",
    );
  }

  const secret = scanSecret(args.text);
  if (secret !== null) {
    return refused(
      "secret_blocked",
      `The message contains an obvious ${secret.kind}; rewrite it without the secret.`,
    );
  }

  if (args.to === agentId) {
    return refused(
      "self_message",
      "Address the message to another agent, not to yourself.",
    );
  }

  const entries = fanoutEntries(ctx, args);
  if (entries.length === 0) {
    return refused(
      "no_other_agents",
      'No other agent is registered in this repo yet, so "everyone" has no recipient.',
    );
  }

  // A reply belongs in the thread of the message it answers. Agents get only
  // the message id (the monitor line says "reply_to <id>"), so a reply_to with
  // no thread_id joins the original's thread instead of starting a new one
  // (live test: both woken replies failed with reply_to_unknown because talk
  // created a fresh thread and then refused the cross-thread reply_to).
  if (args.reply_to !== undefined && args.thread_id === undefined) {
    const original = messagesRepo.findMessage(db, args.reply_to);
    if (original === undefined) {
      return refused("reply_to_unknown", `No message with id ${args.reply_to} exists to reply to.`);
    }
    args = { ...args, thread_id: original.thread_id };
  }

  const threadOutcome = resolveThread(ctx, args, now);
  if (!threadOutcome.ok) {
    return refused(threadOutcome.errorCode, threadOutcome.detail);
  }
  const thread = threadOutcome.thread;

  const count = threadsRepo.countThreadMessages(db, thread.id);
  const postable = checkThreadPostable(thread, count);
  if (!postable.ok) {
    return refused(
      postable.code,
      postable.code === "thread_closed"
        ? "The human closed this thread."
        : "The thread is paused at its message cap; the human can resume it.",
    );
  }

  if (args.reply_to !== undefined) {
    const original = messagesRepo.findMessage(db, args.reply_to);
    if (original?.thread_id !== thread.id) {
      return refused(
        "reply_to_unknown",
        "reply_to must be a message in the same thread.",
      );
    }
  }

  const expiresAt = now + MESSAGE_TTL_MS;
  const deliveries = deliverMessages(ctx, args, thread, entries, expiresAt, now);
  const primary = deliveries[0]?.message;
  if (primary === undefined) {
    return refused("send_failed", "No message row could be created.");
  }

  markReplyReceived(ctx, args.reply_to, now);
  const waking = startWakes(ctx, deliveries);

  const capped = enforceMessageCap(db, thread.id);
  if (capped.status === "paused" && thread.status === "open") {
    // PLAN 4.4 and section 9: the human hears about a thread that hit its cap.
    ctx.notify?.(pausedNotice(capped.title ?? titleFromFirstMessage(args.text), capped.message_cap));
  }

  const reply =
    (args.wait_for_reply_s ?? 0) > 0
      ? await waitForReply(
          ctx,
          primary.id,
          Date.now() + (args.wait_for_reply_s ?? 0) * 1000,
        )
      : undefined;

  const refreshed = messagesRepo.getMessage(db, primary.id);
  const outlook = composeOutlook(ctx, deliveries, waking, now);
  const noticedPause = capped.status === "paused" && thread.status === "open";

  return success(
    buildTalkValue(thread.id, refreshed, outlook, reply),
    buildTalkSummary(ctx, deliveries, outlook, noticedPause, reply),
  );
}

function buildTalkValue(
  threadId: string,
  message: MessageRow,
  outlook: string,
  reply: MessageRow | undefined,
): Record<string, unknown> {
  const value: {
    message_id: string;
    thread_id: string;
    status: MessageRow["status"];
    outlook: string;
    reply?: { message_id: string; from_agent: string; text: string };
  } = {
    message_id: message.id,
    thread_id: threadId,
    status: message.status,
    outlook,
  };
  if (reply !== undefined) {
    value.reply = {
      message_id: reply.id,
      from_agent: reply.from_agent,
      text: reply.body,
    };
  }
  return value;
}

function buildTalkSummary(
  ctx: ToolContext,
  deliveries: Delivery[],
  outlook: string,
  noticedPause: boolean,
  reply: MessageRow | undefined,
): string {
  const ids = deliveries.map((d) => `'${d.recipientId}'`).join(", ");
  const parts = [
    `Sent to ${ids} in thread ${deliveries[0]?.message.thread_id ?? ""} (status ${
      deliveries[0]?.message.status ?? "sent"
    }).`,
    outlook,
  ];
  if (noticedPause) {
    parts.push(
      "The thread just reached its message cap and is paused; ask the human to resume it.",
    );
  }
  if (reply !== undefined) {
    parts.push(`${reply.from_agent} replied before the wait ended.`);
  }
  const reminder = rulesReminder(readRulesFile(ctx.repoRoot));
  if (reminder !== null) {
    parts.push(reminder);
  }
  return parts.join(" ");
}

function fanoutEntries(ctx: ToolContext, args: TalkArgs): FanoutEntry[] {
  if (args.to === "everyone") {
    const others = agentsRepo
      .listAgentsByRepo(ctx.db, ctx.repoRoot)
      .map((agent: AgentRow) => agent.id)
      .filter((id: string) => id !== ctx.agentId);
    return expandEveryone(others, ctx.agentId, args.idempotency_key);
  }
  return expandEveryone([args.to], ctx.agentId, args.idempotency_key);
}

function resolveThread(
  ctx: ToolContext,
  args: TalkArgs,
  now: number,
): ThreadOutcome {
  if (args.thread_id !== undefined) {
    const thread = threadsRepo.findThread(ctx.db, args.thread_id);
    if (thread === undefined) {
      return {
        ok: false,
        errorCode: "thread_not_found",
        detail: `No thread ${args.thread_id} in this hub.`,
      };
    }
    if (thread.repo_root !== ctx.repoRoot) {
      return {
        ok: false,
        errorCode: "thread_not_found",
        detail: "That thread belongs to a different repository.",
      };
    }
    return { ok: true, thread };
  }
  const created = threadsRepo.createThread(ctx.db, {
    id: randomUUID(),
    repoRoot: ctx.repoRoot,
    title: titleFromFirstMessage(args.text),
    status: "open",
    messageCap: DEFAULT_MESSAGE_CAP,
    createdAt: now,
  });
  return { ok: true, thread: created };
}

function deliverMessages(
  ctx: ToolContext,
  args: TalkArgs,
  thread: ThreadRow,
  entries: FanoutEntry[],
  expiresAt: number,
  now: number,
): Delivery[] {
  return entries.map((entry: FanoutEntry) => {
    const inserted = messagesRepo.insertMessageIdempotent(ctx.db, {
      id: randomUUID(),
      threadId: thread.id,
      fromAgent: ctx.agentId,
      toAgent: entry.toAgent,
      kind: args.kind ?? "text",
      body: args.text,
      payloadJson: args.payload === undefined ? null : JSON.stringify(args.payload),
      replyTo: args.reply_to ?? null,
      status: "sent",
      sentAt: now,
      expiresAt,
      idempotencyKey: entry.idempotencyKey,
      estTokens: estimateTokens(args.text),
    });
    if (inserted.created) {
      messageEventsRepo.insertMessageEvent(ctx.db, {
        id: randomUUID(),
        messageId: inserted.message.id,
        event: "sent",
        at: now,
        detailJson: null,
      });
    }
    return { recipientId: entry.toAgent, message: inserted.message };
  });
}

/** The replier's own `talk` calls this: a reply implies the original is read
 * and answered (PLAN 4.3); the guarded update no-ops when the original was
 * never delivered. */
function markReplyReceived(
  ctx: ToolContext,
  replyTo: string | undefined,
  now: number,
): void {
  if (replyTo === undefined) {
    return;
  }
  const stamped = messagesRepo.guardedStatusUpdate(ctx.db, replyTo, {
    status: "replied",
    at: now,
  });
  if (stamped) {
    messageEventsRepo.insertMessageEvent(ctx.db, {
      id: randomUUID(),
      messageId: replyTo,
      event: "replied",
      at: now,
      detailJson: null,
    });
  }
}

/**
 * Start an out-of-band wake (Codex app-server) for each recipient whose new
 * message is still queued, right after it is stored and before any
 * wait_for_reply_s wait. Returns the recipients a wake was started for.
 */
function startWakes(ctx: ToolContext, deliveries: Delivery[]): ReadonlySet<string> {
  const started = new Set<string>();
  if (ctx.wakeRecipient === undefined) {
    return started;
  }
  for (const delivery of deliveries) {
    const agent = agentsRepo.findAgent(ctx.db, delivery.recipientId);
    if (agent !== undefined && delivery.message.status === "sent" && ctx.wakeRecipient(agent.id, agent.harness)) {
      started.add(agent.id);
    }
  }
  return started;
}

function composeOutlook(
  ctx: ToolContext,
  deliveries: Delivery[],
  waking: ReadonlySet<string>,
  now: number,
): string {
  const outlooks = deliveries.map((delivery) => {
    const agent = agentsRepo.findAgent(ctx.db, delivery.recipientId);
    return buildOutlook(
      delivery.recipientId,
      { lastHeartbeat: agent?.last_heartbeat ?? null, waking: waking.has(delivery.recipientId) },
      now,
    );
  });
  const ids = deliveries.map((d) => d.recipientId);
  return pluralOutlook(ids, outlooks);
}

async function waitForReply(
  ctx: ToolContext,
  messageId: string,
  deadline: number,
): Promise<MessageRow | undefined> {
  for (;;) {
    const reply = messagesRepo.findLatestReplyTo(ctx.db, messageId);
    if (reply !== undefined) {
      return reply;
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}
