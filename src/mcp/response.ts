export interface ToolResultShape {
  [x: string]: unknown;
  content: [{ type: "text"; text: string }];
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
 * text summary (PLAN section 5).
 */
export function toToolResult(outcome: ToolOutcome): ToolResultShape {
  if (outcome.isError === true) {
    return {
      content: [{ type: "text", text: outcome.summary }],
      structuredContent: outcome.value,
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: outcome.summary }],
    structuredContent: outcome.value,
  };
}
