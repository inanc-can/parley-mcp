export interface ToolResultShape {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolOutcome {
  value: Record<string, unknown>;
  summary: string;
  isError?: boolean;
}

export function success(value: Record<string, unknown>, summary: string): ToolOutcome {
  return { value, summary };
}

/**
 * Refusals (secret_blocked, stop_all, thread_paused, ...) are normal
 * tool results carrying a machine-readable error code, never thrown
 * protocol errors.
 */
export function refused(code: string, detail: string): ToolOutcome {
  return {
    value: { error: code, detail },
    summary: `Blocked (${code}): ${detail}`,
    isError: true,
  };
}

/**
 * Every Parley MCP tool returns `structuredContent` plus a one-paragraph
 * text summary (PLAN section 5). The MCP spec asks a tool that returns
 * structured content to also return it serialized as text, for clients that
 * only show the model the text blocks; without it such a client would mark
 * inbox messages read (and hand over the rules text) that the model never saw.
 */
export function toToolResult(outcome: ToolOutcome): ToolResultShape {
  const content = [
    { type: "text" as const, text: outcome.summary },
    { type: "text" as const, text: JSON.stringify(outcome.value) },
  ];
  if (outcome.isError === true) {
    return { content, structuredContent: outcome.value, isError: true };
  }
  return { content, structuredContent: outcome.value };
}
