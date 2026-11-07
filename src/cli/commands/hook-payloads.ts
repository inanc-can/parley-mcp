import { z } from "zod";

/**
 * Zod schemas for the Claude Code hook payloads we consume (PLAN section 6,
 * verified against code.claude.com/docs in docs/harness-notes.md). Payloads
 * arrive as JSON on a hook script's stdin. We parse only the fields we use and
 * allow unknown fields so a newer Claude Code can add fields without breaking us.
 *
 * Subagent identification: `agent_id` / `agent_type` are present when a hook
 * fires inside a subagent (or an `--agent` session). PLAN: "ignore hooks fired
 * by subagents" — `isSubagentPayload` is the guard every handler applies first.
 */

const commonFields = {
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  hook_event_name: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
} as const;

export const sessionStartPayloadSchema = z.looseObject({
  ...commonFields,
  source: z.string().optional(),
});

export const userPromptPayloadSchema = z.looseObject({
  ...commonFields,
  prompt: z.string(),
});

export const stopPayloadSchema = z.looseObject({
  ...commonFields,
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
});

export const postToolPayloadSchema = z.looseObject({
  ...commonFields,
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
});

export const sessionEndPayloadSchema = z.looseObject({
  ...commonFields,
  reason: z.string().optional(),
});

export type SessionStartPayload = z.output<typeof sessionStartPayloadSchema>;
export type UserPromptPayload = z.output<typeof userPromptPayloadSchema>;
export type StopPayload = z.output<typeof stopPayloadSchema>;
export type PostToolPayload = z.output<typeof postToolPayloadSchema>;
export type SessionEndPayload = z.output<typeof sessionEndPayloadSchema>;

/**
 * True when the payload came from a subagent (or an in-process teammate): it
 * carries `agent_id` or `agent_type`. Such a hook does not prove the main agent
 * saw anything, so every handler ignores it (PLAN section 6, Claude Code).
 */
export function isSubagentPayload(payload: {
  agent_id?: string | undefined;
  agent_type?: string | undefined;
}): boolean {
  return payload.agent_id !== undefined || payload.agent_type !== undefined;
}

/** basename without importing node:path into this pure boundary module. */
export function basenameOf(dir: string): string {
  const trimmed = dir.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last !== undefined && last.length > 0 ? last : trimmed;
}

/** The Parley agent id for a Claude Code session rooted at `cwd`. */
export function claudeAgentId(cwd: string): string {
  return `claude@${basenameOf(cwd)}`;
}
