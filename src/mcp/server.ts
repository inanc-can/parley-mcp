import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { z } from "zod";
import { retentionCutoff } from "../core/retention.js";
import { applyRetention } from "../store/retention.js";
import { openDb } from "../store/db.js";
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
const DEFAULT_DB_PATH = join(homedir(), ".parley-mcp", "hub.db");

/**
 * Builds the MCP server with the three Parley tools (talk, inbox, agree) wired
 * to a shared tool context. The context holds the SQLite db and the calling
 * agent's id. This is the only place the SDK is imported, so the rest of the
 * MCP layer stays free of SDK details and easy to unit test.
 */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: "parley-mcp",
    version: "0.0.0",
  });

  server.registerTool("talk", {
    description:
      "Send a message to another agent in this repo, or broadcast to everyone. " +
      "Returns message_id, thread_id, status and an honest outlook sentence. " +
      "Blocked by stop-all, secret scan, thread cap, and closed threads.",
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
 * Entry point for `parley-mcp serve` over stdio. Opens the shared SQLite hub
 * (WAL, busy timeout), runs retention, registers the calling agent, then
 * connects the SDK server to stdio. Called by each harness adapter.
 */
export async function serve(options: {
  agentIdEnv?: string | undefined;
  repoRoot?: string | undefined;
}): Promise<void> {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const agentId = resolveAgentId(options.agentIdEnv, repoRoot);
  const db = openDb({ path: DEFAULT_DB_PATH });
  try {
    // Retention on every MCP server start (PLAN 4.7).
    applyRetention(db, retentionCutoff(Date.now()));
    // Register the caller and stamp a heartbeat.
    registerCaller(db, agentId, repoRoot, null, Date.now());

    const ctx: ToolContext = { db, agentId, repoRoot, nativeSession: null, rulesTextSent: false };
    const server = createServer(ctx);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } finally {
    db.close();
  }
}
