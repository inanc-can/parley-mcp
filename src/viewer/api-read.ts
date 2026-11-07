import { createHash } from "node:crypto";
import { isAlive } from "../core/identity.js";
import {
  agentsRepo,
  agreementsRepo,
  messageEventsRepo,
  messagesRepo,
  settingsRepo,
  threadsRepo,
  type AgreementRow,
  type Db,
  type MessageRow,
} from "../store/index.js";

/**
 * Read models for the viewer (PLAN section 8). Plain data, shaped for the page:
 * the agent list, the thread list and one thread's messages, receipts and
 * agreements. Everything is scoped to the repo the viewer was opened in.
 */

export interface AgentView {
  id: string;
  harness: string;
  alive: boolean;
  lastSeen: number | null;
}

export interface ThreadSummary {
  id: string;
  title: string;
  status: "open" | "paused" | "closed";
  messageCount: number;
  messageCap: number;
  estTokens: number;
  lastMessage: { from: string; preview: string; status: MessageRow["status"]; at: number } | null;
}

export interface StateView {
  repoRoot: string;
  stopAll: boolean;
  agents: AgentView[];
  threads: ThreadSummary[];
}

export interface MessageView {
  id: string;
  from: string;
  to: string;
  kind: MessageRow["kind"];
  body: string;
  replyTo: string | null;
  status: MessageRow["status"];
  sentAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  repliedAt: number | null;
  failedAt: number | null;
  estTokens: number;
}

export interface AgreementView {
  id: string;
  text: string;
  status: AgreementRow["status"];
  offeredBy: string;
  offeredTo: string;
  answeredBy: string | null;
  createdAt: number;
  answeredAt: number | null;
  parentId: string | null;
}

export interface ThreadView {
  thread: ThreadSummary;
  messages: MessageView[];
  agreements: AgreementView[];
}

const PREVIEW_CHARS = 80;

export function buildState(db: Db, repoRoot: string, now: number): StateView {
  const agents = agentsRepo.listAgentsByRepo(db, repoRoot).map((agent) => ({
    id: agent.id,
    harness: agent.harness,
    alive: isAlive(agent.last_heartbeat, now),
    lastSeen: agent.last_heartbeat,
  }));
  const threads = threadsRepo
    .listThreadsByRepo(db, repoRoot)
    .map((thread) => summarize(db, thread.id))
    .filter((t): t is ThreadSummary => t !== null)
    .sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0));
  return { repoRoot, stopAll: settingsRepo.getStopAll(db), agents, threads };
}

/** One thread, or null when it does not exist or belongs to another repo. */
export function buildThreadView(db: Db, repoRoot: string, threadId: string): ThreadView | null {
  const row = threadsRepo.findThread(db, threadId);
  if (row?.repo_root !== repoRoot) {
    return null;
  }
  const thread = summarize(db, threadId);
  if (thread === null) {
    return null;
  }
  return {
    thread,
    messages: messagesRepo.listThreadMessages(db, threadId).map(messageView),
    agreements: agreementsRepo.listAgreementsByThread(db, threadId).map(agreementView),
  };
}

function summarize(db: Db, threadId: string): ThreadSummary | null {
  const thread = threadsRepo.findThread(db, threadId);
  if (thread === undefined) {
    return null;
  }
  const messages = messagesRepo.listThreadMessages(db, threadId);
  const last = messages[messages.length - 1];
  return {
    id: thread.id,
    title: thread.title ?? "(untitled)",
    status: thread.status,
    messageCount: messages.length,
    messageCap: thread.message_cap,
    estTokens: messages.reduce((sum, m) => sum + m.est_tokens, 0),
    lastMessage:
      last === undefined
        ? null
        : { from: last.from_agent, preview: preview(last.body), status: last.status, at: last.sent_at },
  };
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

function messageView(m: MessageRow): MessageView {
  return {
    id: m.id,
    from: m.from_agent,
    to: m.to_agent,
    kind: m.kind,
    body: m.body,
    replyTo: m.reply_to,
    status: m.status,
    sentAt: m.sent_at,
    deliveredAt: m.delivered_at,
    readAt: m.read_at,
    repliedAt: m.replied_at,
    failedAt: m.failed_at,
    estTokens: m.est_tokens,
  };
}

function agreementView(a: AgreementRow): AgreementView {
  return {
    id: a.id,
    text: a.text,
    status: a.status,
    offeredBy: a.offered_by,
    offeredTo: a.offered_to,
    answeredBy: a.answered_by,
    createdAt: a.created_at,
    answeredAt: a.answered_at,
    parentId: a.parent_id,
  };
}

/**
 * A fingerprint of everything the page shows. There is no daemon: agents,
 * hooks and monitors write the SQLite file from other processes, so the viewer
 * polls this and pushes an SSE event when it changes. Heartbeats only count
 * when they flip an agent between alive and idle, so a monitor's 2 s heartbeat
 * does not cause an event every poll.
 */
export function changeSignature(db: Db, repoRoot: string, now: number): string {
  const hash = createHash("sha1");
  const state = buildState(db, repoRoot, now);
  hash.update(JSON.stringify({ stop: state.stopAll, agents: state.agents.map((a) => [a.id, a.alive]) }));
  for (const thread of state.threads) {
    hash.update(`${thread.id}:${thread.status}:${String(thread.messageCap)}`);
    for (const m of messagesRepo.listThreadMessages(db, thread.id)) {
      hash.update(`${m.id}:${m.status}:${String(messageEventsRepo.listMessageEvents(db, m.id).length)}`);
    }
    for (const a of agreementsRepo.listAgreementsByThread(db, thread.id)) {
      hash.update(`${a.id}:${a.status}`);
    }
  }
  return hash.digest("hex");
}
