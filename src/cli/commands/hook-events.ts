import { randomUUID } from "node:crypto";
import { parseAgentId } from "../../core/identity.js";
import {
  agentsRepo,
  messageEventsRepo,
  messagesRepo,
  type Db,
} from "../../store/index.js";
import { runHookEdit } from "./hook.js";
import {
  claudeAgentId,
  isSubagentPayload,
  type PostToolPayload,
  type SessionEndPayload,
  type SessionStartPayload,
  type StopPayload,
  type UserPromptPayload,
} from "./hook-payloads.js";

export interface HookEventDeps {
  db: Db;
  repoRoot: string;
  /**
   * Status/diagnostic lines. These must NOT reach the harness's stdout, because
   * Claude Code turns a hook's stdout into model context (SessionStart /
   * UserPromptSubmit additionalContext). Route them to stderr. Only deliveries
   * Claude should actually see belong on stdout (the monitor handles those).
   */
  status: (line: string) => void;
  now?: number;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/**
 * `hook session-start`: register the agent and stamp a heartbeat (PLAN
 * section 6, Claude Code SessionStart). Subagent payloads are ignored.
 */
export function runHookSessionStart(deps: HookEventDeps, payload: SessionStartPayload): void {
  if (ignoreSubagent(deps, payload, "session-start")) {
    return;
  }
  const now = deps.now ?? Date.now();
  const agentId = claudeAgentId(payload.cwd);
  registerAgent(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  deps.status(`registered ${agentId} (session ${payload.session_id})`);
}

/**
 * `hook user-prompt`: read-evidence. A delivered message to this agent whose id
 * appears in the submitted prompt is marked `read` (PLAN 4.3: read is set when
 * the message id is seen in the model's input). Also refreshes the heartbeat.
 * Subagent payloads are ignored.
 */
export function runHookUserPrompt(deps: HookEventDeps, payload: UserPromptPayload): number {
  if (ignoreSubagent(deps, payload, "user-prompt")) {
    return 0;
  }
  const now = deps.now ?? Date.now();
  const agentId = claudeAgentId(payload.cwd);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  const read = markReadByEvidence(deps.db, agentId, payload.prompt, now);
  deps.status(`user-prompt ${agentId}: marked ${String(read)} message(s) read`);
  return read;
}

/**
 * `hook stop`: at the safe point of turn end, drain queued messages (deliver
 * them so the monitor/next turn can surface them). Subagent payloads are
 * ignored. We do NOT treat the final assistant message as read-evidence:
 * PLAN 4.3 restricts read to the model's *input* (UserPromptSubmit prompt or
 * transcript), an `inbox` call, or a reply — the assistant's own output is not
 * in that list, so a delivered-but-unechoed message stays `delivered`.
 */
export function runHookStop(deps: HookEventDeps, payload: StopPayload): void {
  if (ignoreSubagent(deps, payload, "stop")) {
    return;
  }
  const now = deps.now ?? Date.now();
  const agentId = claudeAgentId(payload.cwd);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  const delivered = drain(deps.db, agentId, payload.session_id, now);
  deps.status(`stop ${agentId}: delivered ${String(delivered)} message(s)`);
}

/**
 * `hook post-tool`: at a safe point after a tool call, drain queued messages.
 * For Edit/Write tools, also record the edit (overlap warning, never blocks)
 * via the existing edit hook. Subagent payloads are ignored.
 */
export function runHookPostTool(deps: HookEventDeps, payload: PostToolPayload): void {
  if (ignoreSubagent(deps, payload, "post-tool")) {
    return;
  }
  const now = deps.now ?? Date.now();
  const agentId = claudeAgentId(payload.cwd);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  if (payload.tool_name !== undefined && EDIT_TOOLS.has(payload.tool_name)) {
    const path = editedPath(payload.tool_input);
    if (path !== null) {
      runHookEdit({ db: deps.db, repoRoot: deps.repoRoot, status: deps.status, now }, agentId, path);
    }
  }
  const delivered = drain(deps.db, agentId, payload.session_id, now);
  deps.status(`post-tool ${agentId}: delivered ${String(delivered)} message(s)`);
}

/**
 * `hook session-end`: requeue messages delivered to this ending session but
 * never read, so they go back to `sent` for the agent's next session (PLAN 4.3
 * requeue). Subagent payloads are ignored.
 */
export function runHookSessionEnd(deps: HookEventDeps, payload: SessionEndPayload): number {
  if (ignoreSubagent(deps, payload, "session-end")) {
    return 0;
  }
  const agentId = claudeAgentId(payload.cwd);
  // Requeue only messages delivered to THIS ending session, not every delivered
  // message across the agent's other live sessions (PLAN 4.3 requeue).
  const requeued = messagesRepo.requeueDeliveredToSession(deps.db, agentId, payload.session_id);
  deps.status(`session-end ${agentId}: requeued ${String(requeued)} unread message(s)`);
  return requeued;
}

function ignoreSubagent(deps: HookEventDeps, payload: PayloadMeta, event: string): boolean {
  if (isSubagentPayload(payload)) {
    deps.status(`${event}: ignored subagent payload`);
    return true;
  }
  return false;
}

interface PayloadMeta {
  agent_id?: string | undefined;
  agent_type?: string | undefined;
}

function registerAgent(
  db: Db,
  agentId: string,
  repoRoot: string,
  session: string,
  now: number,
): void {
  const identity = parseAgentId(agentId);
  if (identity === null) {
    throw new Error(`invalid agent id derived from cwd: ${agentId}`);
  }
  agentsRepo.upsertAgent(db, {
    id: agentId,
    harness: identity.harness,
    folder: identity.folder,
    repoRoot,
    nativeSession: session,
    lastHeartbeat: now,
    createdAt: now,
  });
}

function touchHeartbeat(
  db: Db,
  agentId: string,
  repoRoot: string,
  session: string,
  now: number,
): void {
  if (agentsRepo.findAgent(db, agentId) === undefined) {
    registerAgent(db, agentId, repoRoot, session, now);
    return;
  }
  agentsRepo.updateHeartbeat(db, agentId, now, session);
}

/** Mark read any message to `agentId` whose id appears in `text` (read evidence). */
function markReadByEvidence(db: Db, agentId: string, text: string, now: number): number {
  let count = 0;
  // A message seen in the model's input is read. It may still be `sent` (the
  // monitor surfaced it before a drain) or already `delivered`; deliver first
  // if needed, then read, so the guarded state machine moves it legally.
  const candidates = [
    ...messagesRepo.listUndeliveredForRecipient(db, agentId, now),
    ...messagesRepo.listDeliveredForRecipient(db, agentId),
  ];
  for (const message of candidates) {
    if (!text.includes(message.id)) {
      continue;
    }
    if (message.status === "sent") {
      const delivered = messagesRepo.guardedStatusUpdate(db, message.id, {
        status: "delivered",
        at: now,
        deliveredSession: null,
      });
      if (delivered) {
        messageEventsRepo.insertMessageEvent(db, {
          id: randomUUID(),
          messageId: message.id,
          event: "delivered",
          at: now,
          detailJson: null,
        });
      }
    }
    const moved = messagesRepo.guardedStatusUpdate(db, message.id, { status: "read", at: now });
    if (moved) {
      messageEventsRepo.insertMessageEvent(db, {
        id: randomUUID(),
        messageId: message.id,
        event: "read",
        at: now,
        detailJson: null,
      });
      count += 1;
    }
  }
  return count;
}

/** Deliver this agent's pending (sent) messages and record delivered events. */
function drain(db: Db, agentId: string, session: string, now: number): number {
  const pending = messagesRepo.listUndeliveredForRecipient(db, agentId, now);
  for (const message of pending) {
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
  return pending.length;
}

function editedPath(toolInput: Record<string, unknown> | undefined): string | null {
  if (toolInput === undefined) {
    return null;
  }
  const value = toolInput["file_path"];
  return typeof value === "string" && value.length > 0 ? value : null;
}
