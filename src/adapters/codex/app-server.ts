import { spawnSync } from "node:child_process";

/**
 * The Codex app-server idle-wake client (PLAN section 6 "Codex").
 *
 * Hooks do not fire while a Codex session sits idle, so the only way to wake an
 * idle session is `codex app-server` (a stdio JSON-RPC service). This module
 * builds the request envelopes and gates them to the protocol version we
 * verified (codex 0.154.0, app-server v2). It FAILS CLOSED: if the app-server
 * is unreachable or its version does not match, callers must NOT attempt
 * delivery — they report "queued until the next turn" in `outlook` and fall
 * back to the hooks + the MCP server's own inbox drain.
 *
 * Verified method shapes (dist/codex-schema, regenerated with
 * `codex app-server generate-json-schema`): `turn/start` takes
 * `{ threadId, input: UserInput[] }`; `turn/steer` takes
 * `{ threadId, expectedTurnId, input: UserInput[] }`; a `UserInput` text item is
 * `{ type: "text", text }`. See docs/harness-notes.md M5.
 *
 * NOTE: this module never starts a Codex session in tests. The reachability
 * probe is injectable; the request builders are pure and unit-tested against
 * the generated schema's required fields.
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

/** The decision the caller acts on, chosen by {@link planWake}. */
export type WakePlan =
  | { kind: "turn_start"; request: JsonRpcRequest }
  | { kind: "turn_steer"; request: JsonRpcRequest }
  | { kind: "fallback"; reason: string; outlook: string };

export interface WakeContext {
  /** True when the app-server is reachable AND on the verified protocol. */
  gateOpen: boolean;
  /** The recipient's live app-server thread id, if known. */
  threadId: string | null;
  /** The active turn id when the thread is busy; null when the thread is idle. */
  activeTurnId: string | null;
  /** The next JSON-RPC request id to use. */
  requestId: number;
  /** The message text to deliver. */
  text: string;
}

/**
 * Decide how to wake a Codex recipient, failing closed. When the gate is shut
 * (app-server unreachable or version mismatch) or we don't know the thread id,
 * return a `fallback` with an honest `outlook`. Otherwise `turn/steer` a busy
 * thread (at a safe point) or `turn/start` an idle one.
 */
export function planWake(ctx: WakeContext): WakePlan {
  if (!ctx.gateOpen) {
    return {
      kind: "fallback",
      reason: "app-server unreachable or protocol mismatch",
      outlook: "codex is offline to the app-server; queued until its next turn (expires in 24 h)",
    };
  }
  if (ctx.threadId === null) {
    return {
      kind: "fallback",
      reason: "no live app-server thread for the recipient",
      outlook: "codex has no live session; queued until it starts (expires in 24 h)",
    };
  }
  if (ctx.activeTurnId !== null) {
    return {
      kind: "turn_steer",
      request: buildTurnSteer(ctx.requestId, ctx.threadId, ctx.activeTurnId, ctx.text),
    };
  }
  return { kind: "turn_start", request: buildTurnStart(ctx.requestId, ctx.threadId, ctx.text) };
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

/**
 * Best-effort, offline reachability probe used by `doctor`: is the `codex`
 * binary present and on the verified version track? We do NOT open an
 * app-server connection here (that would start a process and is a live action);
 * doctor only needs to know whether idle-wake is plausible. Never throws.
 */
export function codexAppServerReachable(): boolean {
  const result = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (result.error !== undefined || (result.status ?? 1) !== 0) {
    return false;
  }
  const version = parseCodexVersion(result.stdout);
  return gateOpenForVersion(version);
}

/** Pull the semver out of `codex --version` output (e.g. "codex-cli 0.154.0"). */
export function parseCodexVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}
