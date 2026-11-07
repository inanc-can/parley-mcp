import { randomUUID } from "node:crypto";
import { parseAgentId } from "../../core/identity.js";
import {
  agentsRepo,
  messageEventsRepo,
  messagesRepo,
  type Db,
} from "../../store/index.js";
import { runHookEdit, type HookEditDeps } from "./hook.js";
import type { Notifier } from "../../notify/os-notify.js";
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
  /**
   * How to derive this harness's agent id from the payload's cwd when no agent
   * is registered for the session_id yet. Defaults to Claude Code's
   * `claude@<folder>`; the Codex adapter injects `codex@<folder>`. (PLAN 4.1:
   * the id is `<harness>@<folder>`.)
   */
  agentIdForCwd?: (cwd: string) => string;
  /**
   * The tool names that count as a file edit for this harness. Defaults to
   * Claude's Edit/Write/MultiEdit; Codex adds `apply_patch` (verified hook
   * PostToolUse tool names, docs/harness-notes.md M5).
   */
  editTools?: ReadonlySet<string>;
  /** Tell the human about an edit conflict (PLAN section 9). */
  notify?: Notifier;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/**
 * The agent a hook acts as. Identity follows the harness session: the agent
 * this session registered as at SessionStart, found by session_id. The
 * payload's cwd is only the fallback, because cwd drifts when the session runs
 * `cd` (the live test showed a session that cd'd into another folder taking
 * over that folder's agent).
 */
function agentFor(deps: HookEventDeps, payload: { session_id: string; cwd: string }): string {
  const fromSession = agentsRepo.findAgentBySession(deps.db, payload.session_id)?.id;
  if (fromSession !== undefined) {
    return fromSession;
  }
  const derive = deps.agentIdForCwd ?? claudeAgentId;
  return derive(payload.cwd);
}

function editToolsFor(deps: HookEventDeps): ReadonlySet<string> {
  return deps.editTools ?? EDIT_TOOLS;
}

/**
 * `hook session-start`: register the agent and stamp a heartbeat (PLAN
 * section 6, Claude Code SessionStart). Subagent payloads are ignored.
 */
export function runHookSessionStart(deps: HookEventDeps, payload: SessionStartPayload): void {
  if (ignoreSubagent(deps, payload, "session-start")) {
    return;
  }
  const now = deps.now ?? Date.now();
  const agentId = agentFor(deps, payload);
  registerAgent(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  deps.status(`registered ${agentId} (session ${payload.session_id})`);
  // PLAN 4.3 fresh-session requeue: a fresh session (source=startup) means any
  // earlier session — including the monitor process that delivered with its own
  // `monitor-<pid>` session id — is no longer the live reader. Requeue this
  // agent's delivered-but-unread messages so they are shown again, EXCEPT ones
  // already delivered to this brand-new session (there are none yet, but this
  // keeps the call safe if a monitor raced ahead). This is the real path that
  // recovers monitor deliveries, which SessionEnd (keyed on Claude's session
  // id) can never match.
  if (payload.source === "startup") {
    const requeued = messagesRepo.requeueDeliveredForSession(
      deps.db,
      agentId,
      payload.session_id,
    );
    if (requeued > 0) {
      deps.status(
        `session-start ${agentId}: requeued ${String(requeued)} stale delivered-unread message(s)`,
      );
    }
  }
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
  const agentId = agentFor(deps, payload);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  const read = markReadByEvidence(deps.db, agentId, payload.prompt, now);
  deps.status(`user-prompt ${agentId}: marked ${String(read)} message(s) read`);
  return read;
}

/**
 * `hook stop`: at turn end, refresh the heartbeat. We deliberately do NOT drain
 * here. Draining marks a message `delivered` with no way to show its body to
 * Claude (a Stop hook's stdout is not reliably surfaced, and `additionalContext`
 * for PostToolUse is documented but not reliably implemented — see
 * docs/harness-notes.md), so a mid-turn message would be marked delivered yet
 * never shown. Leaving it `sent` lets the monitor surface it and wake the
 * session (PLAN section 6). Subagent payloads are ignored.
 *
 * We also do NOT treat the final assistant message as read-evidence: PLAN 4.3
 * restricts read to the model's *input* (UserPromptSubmit prompt or transcript),
 * an `inbox` call, or a reply — the assistant's own output is not in that list.
 */
export function runHookStop(deps: HookEventDeps, payload: StopPayload): string | null {
  if (ignoreSubagent(deps, payload, "stop")) {
    return null;
  }
  const now = deps.now ?? Date.now();
  const agentId = agentFor(deps, payload);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  deps.status(`stop ${agentId}: heartbeat (delivery left to the monitor or the Codex wake)`);
  return agentId;
}

/**
 * `hook post-tool`: at a safe point after a tool call, refresh the heartbeat
 * and, for Edit/Write tools, record the edit (overlap warning, never blocks).
 * We deliberately do NOT drain here (same reason as `stop`): a drained message
 * is marked `delivered` but its body is never shown to Claude mid-turn, so it
 * would be swallowed. The monitor is the mid-turn delivery path. Subagent
 * payloads are ignored.
 */
export function runHookPostTool(deps: HookEventDeps, payload: PostToolPayload): void {
  if (ignoreSubagent(deps, payload, "post-tool")) {
    return;
  }
  const now = deps.now ?? Date.now();
  const agentId = agentFor(deps, payload);
  touchHeartbeat(deps.db, agentId, deps.repoRoot, payload.session_id, now);
  if (payload.tool_name !== undefined && editToolsFor(deps).has(payload.tool_name)) {
    const path = editedPath(payload.tool_input);
    if (path !== null) {
      const editDeps: HookEditDeps = { db: deps.db, repoRoot: deps.repoRoot, status: deps.status, now };
      if (deps.notify !== undefined) {
        editDeps.notify = deps.notify;
      }
      runHookEdit(editDeps, agentId, path);
    }
  }
  deps.status(`post-tool ${agentId}: heartbeat + edits (delivery left to the monitor)`);
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
  const agentId = agentFor(deps, payload);
  // Requeue only messages delivered to THIS ending session, not every delivered
  // message across the agent's other live sessions (PLAN 4.3 requeue).
  const requeued = messagesRepo.requeueDeliveredToSession(deps.db, agentId, payload.session_id);
  // Also requeue this agent's monitor-surfaced deliveries: a monitor delivers
  // with its own `monitor-<pid>` session id and never fires a Claude SessionEnd,
  // so this is the only hook that can recover an unread monitor delivery.
  const requeuedMonitor = messagesRepo.requeueMonitorDelivered(deps.db, agentId);
  const total = requeued + requeuedMonitor;
  deps.status(`session-end ${agentId}: requeued ${String(total)} unread message(s)`);
  return total;
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

function editedPath(toolInput: Record<string, unknown> | undefined): string | null {
  if (toolInput === undefined) {
    return null;
  }
  const value = toolInput["file_path"];
  return typeof value === "string" && value.length > 0 ? value : null;
}
