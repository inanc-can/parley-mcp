import { basename } from "node:path";
import { z } from "zod";
import { sessionContext } from "../../adapters/cursor/config-files.js";
import type { Notifier } from "../../notify/os-notify.js";
import { agentsRepo, messagesRepo, type Db } from "../../store/index.js";
import { runHookEdit, type HookEditDeps } from "./hook.js";
import {
  runHookSessionEnd,
  runHookSessionStart,
  runHookStop,
  runHookUserPrompt,
  type HookEventDeps,
} from "./hook-events.js";
import { deliverMessage, formatDrainLine } from "./inbox.js";

/**
 * Cursor hook handlers (PLAN section 6 "Cursor"). Payload fields verified
 * against cursor.com/docs/hooks.md (2026-11-07): every hook gets
 * `conversation_id` and `workspace_roots`; sessionStart adds `session_id`
 * (same as conversation_id); beforeSubmitPrompt adds `prompt`; afterFileEdit
 * adds `file_path`; stop adds `status` and `loop_count`. Each handler maps the
 * payload onto the shared hook logic and returns the JSON Cursor reads from
 * stdout.
 */

export const cursorPayloadSchema = z.looseObject({
  conversation_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  workspace_roots: z.array(z.string()).optional(),
  hook_event_name: z.string().optional(),
  prompt: z.string().optional(),
  file_path: z.string().optional(),
  status: z.string().optional(),
  loop_count: z.number().optional(),
  reason: z.string().optional(),
  is_background_agent: z.boolean().optional(),
});
export type CursorPayload = z.output<typeof cursorPayloadSchema>;

export type CursorEvent = "session-start" | "prompt" | "after-edit" | "stop" | "session-end";

export interface CursorHookDeps {
  db: Db;
  repoRoot: string;
  status: (line: string) => void;
  /** This install's launcher, for the watch command the agent is told to run. */
  launcher: string;
  now?: number;
  notify?: Notifier;
  wakeRecipient?: (agentId: string, harness: string) => boolean;
}

/** `cursor@<folder>`, the same `<harness>@<folder>` rule as every adapter (PLAN 4.1). */
export function cursorAgentId(folderPath: string): string {
  return `cursor@${basename(folderPath)}`;
}

/** The chat's session id and the folder it works in, or null when the payload has neither. */
export function cursorSession(
  payload: CursorPayload,
  env: NodeJS.ProcessEnv,
): { session: string; root: string } | null {
  const session = payload.conversation_id ?? payload.session_id;
  const fromEnv = env["CURSOR_PROJECT_DIR"];
  const root = payload.workspace_roots?.[0] ?? (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined);
  return session === undefined || root === undefined ? null : { session, root };
}

/** Cursor's "nothing to do" reply for each event (beforeSubmitPrompt must allow the prompt). */
export function emptyReply(event: CursorEvent): Record<string, unknown> {
  return event === "prompt" ? { continue: true } : {};
}

export function runCursorHook(
  deps: CursorHookDeps,
  event: CursorEvent,
  payload: CursorPayload,
  where: { session: string; root: string },
): Record<string, unknown> {
  const shared: HookEventDeps = {
    db: deps.db,
    repoRoot: deps.repoRoot,
    status: deps.status,
    agentIdForCwd: cursorAgentId,
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.notify === undefined ? {} : { notify: deps.notify }),
  };
  const base = { session_id: where.session, cwd: where.root };

  switch (event) {
    case "session-start": {
      // Every Cursor sessionStart is a new conversation: requeue as a fresh start (PLAN 4.3).
      runHookSessionStart(shared, { ...base, source: "startup" });
      const agentId = agentsRepo.findAgentBySession(deps.db, where.session)?.id ?? cursorAgentId(where.root);
      return {
        env: { PARLEY_AGENT_ID: agentId },
        additional_context: sessionContext(deps.launcher, agentId, where.session),
      };
    }
    case "prompt":
      // A message id in the submitted prompt (e.g. our stop follow-up) is read evidence.
      runHookUserPrompt(shared, { ...base, prompt: payload.prompt ?? "" });
      return { continue: true };
    case "after-edit": {
      if (payload.file_path !== undefined) {
        const agentId = agentsRepo.findAgentBySession(deps.db, where.session)?.id ?? cursorAgentId(where.root);
        const editDeps: HookEditDeps = { db: deps.db, repoRoot: deps.repoRoot, status: deps.status, cwd: where.root };
        if (deps.now !== undefined) editDeps.now = deps.now;
        if (deps.notify !== undefined) editDeps.notify = deps.notify;
        if (deps.wakeRecipient !== undefined) editDeps.wakeRecipient = deps.wakeRecipient;
        runHookEdit(editDeps, agentId, payload.file_path);
      }
      return {};
    }
    case "stop":
      return stopFollowup(deps, shared, base);
    case "session-end":
      runHookSessionEnd(shared, base);
      return {};
  }
}

/**
 * At the end of a turn, hand anything still queued to Cursor as the next user
 * message (`followup_message`), the fallback when no background watch caught
 * it. Messages are claimed (guarded) so the watch and stop never both deliver
 * one.
 */
function stopFollowup(
  deps: CursorHookDeps,
  shared: HookEventDeps,
  base: { session_id: string; cwd: string },
): Record<string, unknown> {
  const agentId = runHookStop(shared, base);
  if (agentId === null) {
    return {};
  }
  const now = deps.now ?? Date.now();
  const lines: string[] = [];
  for (const message of messagesRepo.listUndeliveredForRecipient(deps.db, agentId, now)) {
    if (deliverMessage(deps.db, message, now, base.session_id)) {
      lines.push(formatDrainLine(message, "monitor"));
    }
  }
  if (lines.length === 0) {
    return {};
  }
  deps.status(`cursor stop ${agentId}: follow-up with ${String(lines.length)} message(s)`);
  return { followup_message: lines.join("\n") };
}
