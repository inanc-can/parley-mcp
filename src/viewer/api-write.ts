import { randomUUID } from "node:crypto";
import { estimateTokens } from "../core/cost.js";
import { scanSecret } from "../core/guards.js";
import { MESSAGE_TTL_MS } from "../core/message-rules.js";
import { CAP_INCREASE } from "../core/threads.js";
import {
  agentsRepo,
  agreementsRepo,
  messageEventsRepo,
  messagesRepo,
  settingsRepo,
  threadsRepo,
  type Db,
  type MessageRow,
} from "../store/index.js";

/**
 * The human's actions from the viewer (PLAN section 8 and "The human stays in
 * control"): post into a thread as `you`, pause/resume/close a thread, veto an
 * accepted agreement, and flip stop-all. Each returns a result the HTTP layer
 * maps to a status code; none throws for a user mistake.
 */

/** The participant id the human posts as (PLAN: "posts into threads as participant `you`"). */
export const HUMAN_ID = "you";
/** The sender of messages the hub writes itself (veto notices). */
export const SYSTEM_ID = "system";

export type ActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409; code: string; detail: string };

export interface WriteDeps {
  db: Db;
  repoRoot: string;
  now: number;
  /** Wake a recipient that needs an out-of-band wake (Codex); optional. */
  wakeRecipient?: (agentId: string, harness: string) => boolean;
}

function fail(status: 400 | 404 | 409, code: string, detail: string): ActionResult<never> {
  return { ok: false, status, code, detail };
}

function threadInRepo(deps: WriteDeps, threadId: string) {
  const thread = threadsRepo.findThread(deps.db, threadId);
  return thread?.repo_root === deps.repoRoot ? thread : undefined;
}

/**
 * Post as `you` into a thread: one message row per agent taking part in it
 * (everyone who sent or received a message there), sharing the thread. The
 * human is not limited by the thread cap or stop-all (those restrain agents),
 * but a closed thread stays closed and the secret scan still applies.
 */
export function postAsHuman(
  deps: WriteDeps,
  threadId: string,
  text: string,
  idempotencyKey: string,
): ActionResult<{ messageIds: string[]; recipients: string[] }> {
  const thread = threadInRepo(deps, threadId);
  if (thread === undefined) {
    return fail(404, "thread_not_found", "No such thread in this repo.");
  }
  if (thread.status === "closed") {
    return fail(409, "thread_closed", "This thread is closed.");
  }
  const body = text.trim();
  if (body.length === 0) {
    return fail(400, "empty_message", "Write something first.");
  }
  const secret = scanSecret(body);
  if (secret !== null) {
    return fail(400, "secret_blocked", `The message contains an obvious ${secret.kind}; remove it first.`);
  }
  const recipients = participants(messagesRepo.listThreadMessages(deps.db, threadId));
  if (recipients.length === 0) {
    return fail(409, "no_participants", "No agent takes part in this thread yet.");
  }
  const messageIds: string[] = [];
  for (const to of recipients) {
    const inserted = messagesRepo.insertMessageIdempotent(deps.db, {
      id: randomUUID(),
      threadId,
      fromAgent: HUMAN_ID,
      toAgent: to,
      kind: "text",
      body,
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: deps.now,
      expiresAt: deps.now + MESSAGE_TTL_MS,
      idempotencyKey: `${idempotencyKey}::${to}`,
      estTokens: estimateTokens(body),
    });
    if (inserted.created) {
      recordEvent(deps, inserted.message.id, "sent");
      const agent = agentsRepo.findAgent(deps.db, to);
      if (agent !== undefined) {
        deps.wakeRecipient?.(agent.id, agent.harness);
      }
    }
    messageIds.push(inserted.message.id);
  }
  return { ok: true, value: { messageIds, recipients } };
}

function participants(messages: MessageRow[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    ids.add(m.from_agent);
    ids.add(m.to_agent);
  }
  ids.delete(HUMAN_ID);
  ids.delete(SYSTEM_ID);
  return [...ids].sort();
}

/** Pause an open thread: agents' talk calls in it are refused until resumed. */
export function pauseThread(deps: WriteDeps, threadId: string): ActionResult {
  const thread = threadInRepo(deps, threadId);
  if (thread === undefined) {
    return fail(404, "thread_not_found", "No such thread in this repo.");
  }
  if (thread.status !== "open") {
    return fail(409, "not_open", `The thread is ${thread.status}.`);
  }
  threadsRepo.setThreadStatus(deps.db, threadId, "paused");
  return { ok: true, value: undefined };
}

/** Resume a paused thread and give it 20 more messages (PLAN 4.4). */
export function resumeThread(deps: WriteDeps, threadId: string): ActionResult {
  const thread = threadInRepo(deps, threadId);
  if (thread === undefined) {
    return fail(404, "thread_not_found", "No such thread in this repo.");
  }
  if (thread.status !== "paused") {
    return fail(409, "not_paused", `The thread is ${thread.status}.`);
  }
  const count = threadsRepo.countThreadMessages(deps.db, threadId);
  // Room for 20 more from where the conversation is now, even if the cap was passed.
  threadsRepo.addThreadCap(deps.db, threadId, Math.max(0, count - thread.message_cap) + CAP_INCREASE);
  threadsRepo.setThreadStatus(deps.db, threadId, "open");
  return { ok: true, value: undefined };
}

/** Close a thread for good (PLAN 4.4: the human can resume it or close it). */
export function closeThread(deps: WriteDeps, threadId: string): ActionResult {
  const thread = threadInRepo(deps, threadId);
  if (thread === undefined) {
    return fail(404, "thread_not_found", "No such thread in this repo.");
  }
  if (thread.status === "closed") {
    return fail(409, "already_closed", "The thread is already closed.");
  }
  threadsRepo.setThreadStatus(deps.db, threadId, "closed");
  return { ok: true, value: undefined };
}

/**
 * Veto an accepted agreement (PLAN section 5): status `vetoed`, and both agents
 * get a system message in the agreement's thread saying so.
 */
export function vetoAgreement(deps: WriteDeps, agreementId: string): ActionResult {
  const agreement = agreementsRepo.findAgreement(deps.db, agreementId);
  if (agreement?.repo_root !== deps.repoRoot) {
    return fail(404, "agreement_not_found", "No such agreement in this repo.");
  }
  if (!agreementsRepo.vetoAgreement(deps.db, agreementId, deps.now)) {
    return fail(409, "not_accepted", `Only an accepted agreement can be vetoed; this one is ${agreement.status}.`);
  }
  const body = `The human vetoed this agreement, so it no longer holds: "${agreement.text}"`;
  for (const to of [agreement.offered_by, agreement.offered_to]) {
    const inserted = messagesRepo.insertMessageIdempotent(deps.db, {
      id: randomUUID(),
      threadId: agreement.thread_id,
      fromAgent: SYSTEM_ID,
      toAgent: to,
      kind: "text",
      body,
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: deps.now,
      expiresAt: deps.now + MESSAGE_TTL_MS,
      idempotencyKey: `veto-${agreementId}::${to}`,
      estTokens: estimateTokens(body),
    });
    if (inserted.created) {
      recordEvent(deps, inserted.message.id, "sent");
    }
  }
  return { ok: true, value: undefined };
}

/** Turn stop-all on or off (PLAN 4.4: blocks every talk call while on). */
export function setStopAll(deps: WriteDeps, on: boolean): ActionResult<{ stopAll: boolean }> {
  settingsRepo.setStopAll(deps.db, on);
  return { ok: true, value: { stopAll: on } };
}

function recordEvent(deps: WriteDeps, messageId: string, event: string): void {
  messageEventsRepo.insertMessageEvent(deps.db, {
    id: randomUUID(),
    messageId,
    event,
    at: deps.now,
    detailJson: null,
  });
}
