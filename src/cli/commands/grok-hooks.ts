import { basename } from "node:path";
import { z } from "zod";
import { grokWatchCommand } from "../../adapters/grok/config-files.js";
import type { Notifier } from "../../notify/os-notify.js";
import { settingsRepo, type Db } from "../../store/index.js";
import {
  runHookPostTool,
  runHookSessionEnd,
  runHookSessionStart,
  runHookStop,
  runHookUserPrompt,
  type HookEventDeps,
} from "./hook-events.js";
import { watchHeartbeatKey } from "./inbox.js";

/**
 * Grok Build hook handlers (PLAN section 6 "Grok Build"). Payload fields from
 * docs.x.ai/build/features/hooks (2026-11-08): camelCase `hookEventName`,
 * `sessionId`, `cwd`, `workspaceRoot`, and `toolName`/`toolInput` for tool
 * events; env `GROK_SESSION_ID` etc. The Stop fields `reason`,
 * `stopHookActive`, `subagentType` and `backgroundTasks` are not in the docs
 * (Concord documents them); they are optional here.
 */

export const grokPayloadSchema = z.looseObject({
  hookEventName: z.string().optional(),
  sessionId: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  toolName: z.string().optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  prompt: z.string().optional(),
  reason: z.string().optional(),
  stopHookActive: z.boolean().optional(),
  subagentType: z.string().optional(),
  backgroundTasks: z
    .array(z.looseObject({ type: z.string().optional(), description: z.string().optional(), command: z.string().optional() }))
    .optional(),
});
export type GrokPayload = z.output<typeof grokPayloadSchema>;

export type GrokEvent = "session-start" | "user-prompt" | "post-tool" | "stop" | "session-end";

export interface GrokHookDeps {
  db: Db;
  repoRoot: string;
  status: (line: string) => void;
  launcher: string;
  now?: number;
  notify?: Notifier;
  wakeRecipient?: (agentId: string, harness: string) => boolean;
}

/** Grok's edit tools, plus the Claude names Grok maps onto them (docs). */
const GROK_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "edit", "write", "edit_file", "write_file", "create_file", "str_replace"]);

/** How fresh a watch heartbeat must be to count as a running monitor. */
export const WATCH_FRESH_MS = 15_000;

/** `grok@<folder>`, the `<harness>@<folder>` rule (PLAN 4.1), from the session's cwd like the MCP server. */
export function grokAgentId(folderPath: string): string {
  return `grok@${basename(folderPath)}`;
}

export function grokSession(payload: GrokPayload, env: NodeJS.ProcessEnv): { session: string; folder: string } | null {
  const fromEnv = env["GROK_SESSION_ID"];
  const session = payload.sessionId ?? (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined);
  const folder = payload.cwd ?? payload.workspaceRoot;
  return session === undefined || folder === undefined ? null : { session, folder };
}

/** Remembers the last session we reminded, so the Stop reminder fires once per session. */
function nudgedKey(agentId: string): string {
  return `grok-nudged:${agentId}`;
}

/**
 * Returns the JSON to print on stdout, or null for nothing. Only Stop prints:
 * the once-per-session reminder `{ decision: "block", reason }` (PLAN).
 */
export function runGrokHook(
  deps: GrokHookDeps,
  event: GrokEvent,
  payload: GrokPayload,
  where: { session: string; folder: string },
): Record<string, unknown> | null {
  const shared: HookEventDeps = {
    db: deps.db,
    repoRoot: deps.repoRoot,
    status: deps.status,
    agentIdForCwd: grokAgentId,
    editTools: GROK_EDIT_TOOLS,
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.notify === undefined ? {} : { notify: deps.notify }),
    ...(deps.wakeRecipient === undefined ? {} : { wakeRecipient: deps.wakeRecipient }),
  };
  const base = { session_id: where.session, cwd: where.folder };
  switch (event) {
    case "session-start":
      runHookSessionStart(shared, { ...base, source: "startup" });
      return null;
    case "user-prompt":
      runHookUserPrompt(shared, { ...base, prompt: payload.prompt ?? "" });
      return null;
    case "post-tool":
      runHookPostTool(shared, {
        ...base,
        ...(payload.toolName === undefined ? {} : { tool_name: payload.toolName }),
        ...(payload.toolInput === undefined ? {} : { tool_input: payload.toolInput }),
      });
      return null;
    case "stop":
      return stopReminder(deps, shared, payload, base);
    case "session-end":
      runHookSessionEnd(shared, base);
      return null;
  }
}

/**
 * PLAN: "If a turn ends with no monitor running, the Stop hook keeps the turn
 * open once and gives the agent the exact command." A monitor counts as
 * running when Grok lists it among the session's background tasks, or when our
 * watch refreshed its heartbeat in the last 15 s.
 */
function stopReminder(
  deps: GrokHookDeps,
  shared: HookEventDeps,
  payload: GrokPayload,
  base: { session_id: string; cwd: string },
): Record<string, unknown> | null {
  if (payload.stopHookActive === true || payload.subagentType !== undefined) {
    return null;
  }
  if (payload.reason !== undefined && payload.reason !== "end_turn") {
    return null;
  }
  const agentId = runHookStop(shared, base);
  if (agentId === null) {
    return null;
  }
  const now = deps.now ?? Date.now();
  const listed = (payload.backgroundTasks ?? []).some((task) =>
    [task.command, task.description].some((text) => text?.includes("inbox watch") === true),
  );
  const beat = Number(settingsRepo.getSetting(deps.db, watchHeartbeatKey(agentId)) ?? "0");
  if (listed || now - beat <= WATCH_FRESH_MS) {
    return null;
  }
  if (settingsRepo.getSetting(deps.db, nudgedKey(agentId)) === base.session_id) {
    return null; // already reminded this session: once only
  }
  settingsRepo.setSetting(deps.db, nudgedKey(agentId), base.session_id);
  deps.status(`grok stop ${agentId}: no monitor running; reminding once`);
  return {
    decision: "block",
    reason:
      `mcp-parley: this session (${agentId}) is not watching for messages from other agents. ` +
      `Start one persistent \`monitor\` for: ${grokWatchCommand(deps.launcher, agentId)} — then end your turn.`,
  };
}
