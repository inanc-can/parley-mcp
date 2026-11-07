/**
 * The Codex app-server idle-wake protocol pieces (PLAN section 6 "Codex").
 *
 * Hooks do not fire while a Codex session sits idle, so the only way to wake
 * one is the app-server. Verified live against codex 0.154.0
 * (docs/harness-notes.md, M5): a `codex` TUI started while the app-server
 * daemon runs attaches to it, and a second client on the daemon's control
 * socket (control-socket.ts) can `turn/start` that TUI's thread; the TUI shows
 * the turn. This module holds the pure parts: request builders, the version
 * gate and the wake decision. src/cli/commands/codex-wake.ts runs them.
 *
 * FAILS CLOSED: no daemon, another protocol version, or a closed session mean
 * no delivery attempt; the message stays queued for the MCP inbox or a later
 * wake. A busy thread is waited on, not steered (PLAN prefers queuing).
 *
 * Verified method shapes (`codex app-server generate-json-schema`):
 * `turn/start` takes `{ threadId, input: UserInput[] }`; `turn/steer` takes
 * `{ threadId, expectedTurnId, input }`; a text `UserInput` is
 * `{ type: "text", text }`; `thread/read` returns `thread.status.type` of
 * `idle | active | notLoaded`.
 */

/** The app-server protocol track this adapter was written and verified against. */
export const VERIFIED_CODEX_VERSION = "0.154.0";
export const VERIFIED_PROTOCOL = "v2" as const;

/** A JSON-RPC request envelope for the app-server. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** A Codex `UserInput` text item (the only variant we send). */
export interface TextUserInput {
  type: "text";
  text: string;
}

export function textInput(text: string): TextUserInput {
  return { type: "text", text };
}

/**
 * Build a `turn/start` request: start a new turn on an idle thread with the
 * given text. Used when the thread has no active turn (PLAN: prefer this over
 * steering). `threadId` is the live app-server thread for the recipient session.
 */
export function buildTurnStart(id: number, threadId: string, text: string): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: { threadId, input: [textInput(text)] },
  };
}

/**
 * Build a `turn/steer` request: inject text into a BUSY turn. `expectedTurnId`
 * is a required precondition — the call fails if it is not the currently active
 * turn (or the active turn is not steerable, e.g. /review or /compact, which
 * the app-server rejects with `activeTurnNotSteerable`). We only steer at a safe
 * point; PLAN prefers queuing until the turn ends and then `turn/start`.
 */
export function buildTurnSteer(
  id: number,
  threadId: string,
  expectedTurnId: string,
  text: string,
): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "turn/steer",
    params: { threadId, expectedTurnId, input: [textInput(text)] },
  };
}

/** A thread's status as `thread/read` reports it (verified values, 0.154.0). */
export type ThreadStatus = "idle" | "active" | "notLoaded" | "unknown";

/** The decision the caller acts on, chosen by {@link planWake}. */
export type WakePlan =
  | { kind: "turn_start"; request: JsonRpcRequest }
  | { kind: "wait"; reason: string }
  | { kind: "fallback"; reason: string; outlook: string };

export interface WakeContext {
  /** True when the app-server is reachable AND on the verified protocol. */
  gateOpen: boolean;
  /** The recipient's app-server thread id (its hook session_id), if known. */
  threadId: string | null;
  /** The thread's live status from `thread/read`. */
  threadStatus: ThreadStatus;
  /** The next JSON-RPC request id to use. */
  requestId: number;
  /** The message text to deliver. */
  text: string;
}

/**
 * Decide how to wake a Codex recipient, failing closed (PLAN section 6 Codex).
 *
 * - gate shut (daemon unreachable or another protocol) -> fallback, queued;
 * - no thread id, or the thread is not loaded (the session was closed; the
 *   daemon unloads an idle thread once its TUI quits) -> fallback, queued. We
 *   never `thread/resume` it: that would run a turn nobody is watching;
 * - busy (`active`) -> wait. PLAN prefers queuing until the turn ends over
 *   steering, so the caller polls until idle (or leaves it queued);
 * - idle -> `turn/start`, which the attached TUI shows as a new turn.
 */
export function planWake(ctx: WakeContext): WakePlan {
  if (!ctx.gateOpen) {
    return {
      kind: "fallback",
      reason: "app-server unreachable or protocol mismatch",
      outlook: "the Codex app-server daemon is not reachable; queued until its next turn (expires in 24 h)",
    };
  }
  if (ctx.threadId === null || ctx.threadStatus === "notLoaded" || ctx.threadStatus === "unknown") {
    return {
      kind: "fallback",
      reason: "no live app-server thread for the recipient",
      outlook: "its Codex session is not open; queued until it starts (expires in 24 h)",
    };
  }
  if (ctx.threadStatus === "active") {
    return { kind: "wait", reason: "the recipient's turn is still running" };
  }
  return { kind: "turn_start", request: buildTurnStart(ctx.requestId, ctx.threadId, ctx.text) };
}

/**
 * Pull the Codex version out of the daemon's `initialize` userAgent, e.g.
 * "codex-tui/0.154.0 (Ubuntu 24.4.0; x86_64) linux (probe; 0)" (verified).
 */
export function versionFromUserAgent(userAgent: string): string | null {
  const match = /^[^/\s]+\/(\d+\.\d+\.\d+)/.exec(userAgent);
  return match?.[1] ?? null;
}

/**
 * Whether the gate is open: the installed Codex matches the verified version
 * track. We compare the major.minor the adapter was built against; a different
 * track means the app-server protocol may have changed, so we fail closed. The
 * version string is injectable for tests.
 */
export function gateOpenForVersion(installedVersion: string | null): boolean {
  if (installedVersion === null) {
    return false;
  }
  return sameMinorTrack(installedVersion, VERIFIED_CODEX_VERSION);
}

function sameMinorTrack(a: string, b: string): boolean {
  const pa = a.split(".");
  const pb = b.split(".");
  return pa[0] === pb[0] && pa[1] === pb[1];
}

/** Pull the semver out of `codex --version` output (e.g. "codex-cli 0.154.0"). */
export function parseCodexVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}
