import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Notifier } from "../notify/os-notify.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { retentionCutoff } from "../core/retention.js";
import { applyRetention } from "../store/retention.js";
import { openDb } from "../store/db.js";
import { agentsRepo } from "../store/index.js";
import { resolveAgentId, registerCaller } from "./identity.js";
import { handleTalk, talkArgsShape } from "./tools/talk.js";
import { handleInbox, inboxArgsShape } from "./tools/inbox.js";
import { handleAgree, agreeArgsShape } from "./tools/agree.js";
import { toToolResult } from "./response.js";
import type { ToolContext } from "./context.js";

type TalkArgs = z.output<z.ZodObject<typeof talkArgsShape>>;
type InboxArgs = z.output<z.ZodObject<typeof inboxArgsShape>>;
type AgreeArgs = z.output<z.ZodObject<typeof agreeArgsShape>>;

const DEFAULT_REPO_ROOT = process.cwd();
const DEFAULT_DB_PATH = join(homedir(), ".mcp-parley", "hub.db");

/**
 * Options for `serve`. `dbPath`, `stdin` and `stdout` default to the production
 * values (the shared hub db and process stdio) and are exposed so tests can
 * point `serve()` at a temporary database and drive it over a stream pair.
 */
export interface ServeOptions {
  agentIdEnv?: string | undefined;
  repoRoot?: string | undefined;
  /** The harness session's own folder; names the agent (default: process.cwd()). */
  cwd?: string | undefined;
  /** The harness's native session id (Claude Code: CLAUDE_CODE_SESSION_ID). */
  sessionId?: string | undefined;
  dbPath?: string | undefined;
  stdin?: Readable | undefined;
  stdout?: Writable | undefined;
  /** Starts an out-of-band wake for a recipient (see ToolContext.wakeRecipient). */
  wakeRecipient?: ((agentId: string, harness: string) => boolean) | undefined;
  /** OS notifications for the human (PLAN section 9). */
  notify?: Notifier | undefined;
  /**
   * Learn the open folder from the client's MCP roots (Cursor: a user-level
   * server may start outside the project). Needs `repoRootFor`.
   */
  useRoots?: boolean | undefined;
  /** Maps a folder to its repo root (git top level); used with `useRoots`. */
  repoRootFor?: ((dir: string) => string) | undefined;
}

/**
 * Builds the MCP server with the three Parley tools (talk, inbox, agree) wired
 * to a shared tool context. The context holds the SQLite db and the calling
 * agent's id. This is the only place the SDK is imported, so the rest of the
 * MCP layer stays free of SDK details and easy to unit test.
 */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: "mcp-parley",
    version: "0.0.0",
  });

  server.registerTool("talk", {
    description:
      "Send a message to another agent in this repo, or broadcast to everyone. " +
      "Returns message_id, thread_id, status and an honest outlook sentence. " +
      "Blocked by stop-all, secret scan, thread cap, and closed threads. " +
      "When another agent messages you, answer it here (reply_to its message id).",
    inputSchema: z.object(talkArgsShape),
  }, async (args: TalkArgs) => {
    const outcome = await handleTalk(ctx, args);
    return toToolResult(outcome);
  });

  server.registerTool("inbox", {
    description:
      "Read your own inbox: messages addressed to you (optionally in one " +
      "thread), marked as read on return. Optionally include your sent " +
      "receipts, accepted decisions, and the list of agents in this repo.",
    inputSchema: z.object(inboxArgsShape),
  }, (args: InboxArgs) => {
    const outcome = handleInbox(ctx, args);
    return toToolResult(outcome);
  });

  server.registerTool("agree", {
    description:
      "Offer, accept, counter or reject an agreement in a thread, or claim " +
      "a path glob for 2 hours (renew / release). Accepted agreements go into " +
      "the repo's decisions log and can be vetoed by the human in the viewer.",
    inputSchema: z.object(agreeArgsShape),
  }, (args: AgreeArgs) => {
    const outcome = handleAgree(ctx, args);
    return toToolResult(outcome);
  });

  return server;
}

/**
 * A running `serve()` session. `isClosed()` reports whether the hub db has
 * been closed (on transport close, stdin end/close, or an explicit `close()`).
 * `close()` tears the session down and is idempotent.
 */
export interface ServeHandle {
  isClosed(): boolean;
  close(): void;
}

/**
 * Entry point for `mcp-parley serve` over stdio. Opens the shared SQLite hub
 * (WAL, busy timeout), runs retention, registers the calling agent, then
 * connects the SDK server to stdio. Called by each harness adapter. Resolves
 * with a handle once the transport is wired up; the hub db stays open until
 * the session closes.
 */
export async function serve(options: ServeOptions = {}): Promise<ServeHandle> {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const sessionId = options.sessionId !== undefined && options.sessionId.length > 0 ? options.sessionId : null;
  const db = openDb({ path: options.dbPath ?? DEFAULT_DB_PATH });
  // Identity: an explicit PARLEY_AGENT_ID wins; then the agent this harness
  // session already registered as (its SessionStart hook ran first); else
  // harness@<the session's folder>. Never the repo root's name: the live test
  // showed the server naming itself after the repo root, so a session in
  // repo/api sent messages as claude@repo instead of claude@api.
  const agentId =
    options.agentIdEnv !== undefined && options.agentIdEnv.length > 0
      ? resolveAgentId(options.agentIdEnv, options.cwd ?? process.cwd())
      : (sessionId === null ? undefined : agentsRepo.findAgentBySession(db, sessionId)?.id) ??
        resolveAgentId(undefined, options.cwd ?? process.cwd());
  let closed = false;
  const closeDb = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    db.close();
  };
  try {
    // Retention on every MCP server start (PLAN 4.7).
    applyRetention(db, retentionCutoff(Date.now()));
    // Register the caller and stamp a heartbeat.
    registerCaller(db, agentId, repoRoot, sessionId, Date.now());

    const ctx: ToolContext = { db, agentId, repoRoot, nativeSession: sessionId, rulesTextSent: false };
    if (options.wakeRecipient !== undefined) {
      ctx.wakeRecipient = options.wakeRecipient;
    }
    if (options.notify !== undefined) {
      ctx.notify = options.notify;
    }
    const server = createServer(ctx);
    const stdin = options.stdin ?? process.stdin;
    const transport = new StdioServerTransport(stdin, options.stdout ?? process.stdout);

    // The db must stay open for the whole stdio session. server.connect()
    // returns as soon as stdio is wired up, but real tool calls arrive later
    // on stdin, so the db cannot be closed in a finally right after connect.
    // The close handler is registered BEFORE connect so no close can be missed
    // in the window between connect returning and the handler being set.
    //
    // server.connect() preserves an existing transport.onclose and chains it
    // (shared/protocol.js wraps the prior handler), so setting it here keeps
    // the SDK's own close handling and also closes the db. We also close the
    // db when stdin ends or closes (the harness went away), which covers a
    // transport that ends the input stream without a protocol-level close.
    transport.onclose = closeDb;
    stdin.on("end", closeDb);
    stdin.on("close", closeDb);

    if (options.useRoots === true && options.repoRootFor !== undefined && options.agentIdEnv === undefined) {
      const repoRootFor = options.repoRootFor;
      server.server.oninitialized = () => {
        void adoptRootFolder(server, ctx, repoRootFor).catch(() => undefined);
      };
    }
    await server.connect(transport);
    return { isClosed: () => closed, close: closeDb };
  } catch (error) {
    closeDb();
    throw error;
  }
}

/**
 * Name the agent after the first folder the client reports as an MCP root and
 * move it to that folder's repo (PLAN section 6 Cursor: "use MCP roots to
 * learn the open folder"). Keeps the startup identity when the client has no
 * roots or reports none.
 */
export async function adoptRootFolder(
  server: McpServer,
  ctx: ToolContext,
  repoRootFor: (dir: string) => string,
): Promise<void> {
  if (server.server.getClientCapabilities()?.roots === undefined) {
    return;
  }
  const { roots } = await server.server.listRoots();
  const first = roots.find((root) => root.uri.startsWith("file://"));
  if (first === undefined || !ctx.db.open) {
    return;
  }
  const folder = fileURLToPath(first.uri);
  const agentId = resolveAgentId(undefined, folder);
  const repoRoot = repoRootFor(folder);
  if (agentId === ctx.agentId && repoRoot === ctx.repoRoot) {
    return;
  }
  ctx.agentId = agentId;
  ctx.repoRoot = repoRoot;
  registerCaller(ctx.db, agentId, repoRoot, ctx.nativeSession, Date.now());
}
