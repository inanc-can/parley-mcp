import { basename } from "node:path";
import { z } from "zod";
import {
  buildTurnStart,
  gateOpenForVersion,
  planWake,
  versionFromUserAgent,
  type ThreadStatus,
} from "../../adapters/codex/app-server.js";
import { RpcError, type RpcConnection } from "../../adapters/codex/control-socket.js";
import { agentsRepo, messagesRepo, type AgentRow, type Db, type MessageRow } from "../../store/index.js";
import { deliverMessage, formatDrainLine } from "./inbox.js";

/**
 * `mcp-parley codex-wake --agent <id>`: wake an idle Codex session so it reads
 * its Parley messages now (PLAN section 6 Codex, milestone M5).
 *
 * How (verified live against codex 0.154.0, docs/harness-notes.md):
 * a `codex` TUI started while the app-server daemon runs attaches to it; the
 * thread id equals the session_id the Codex hooks see, which SessionStart
 * stores as the agent's native session. This command connects to the daemon's
 * control socket, checks the protocol version, reads the thread's status and,
 * when idle, `turn/start`s it with the pending messages. The TUI shows that as
 * a new turn, and its UserPromptSubmit hook sees the message ids in the prompt,
 * which is the read evidence (PLAN 4.3).
 *
 * Fails closed: no daemon, another protocol, or a closed session leave the
 * messages `sent` (queued) for the MCP inbox or a later wake. A busy thread is
 * polled until its turn ends (PLAN: queue, don't steer), up to `waitMs`; the
 * Codex Stop hook starts another wake at the end of each turn as a backstop.
 */

export interface CodexWakeDeps {
  db: Db;
  /** Open an RPC connection to the daemon's control socket. */
  connect: () => Promise<RpcConnection>;
  status: (line: string) => void;
  /** How long to keep polling a busy thread before leaving the message queued. */
  waitMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type CodexWakeOutcome =
  | { kind: "woken"; delivered: number; threadId: string }
  | { kind: "nothing_pending" }
  | { kind: "busy"; threadId: string }
  | { kind: "not_codex" }
  | { kind: "fallback"; reason: string };

const CLIENT_INFO = { name: "mcp-parley", title: "mcp-parley", version: "0.0.0" };
const DEFAULT_POLL_MS = 500;

const initializeResultSchema = z.looseObject({ userAgent: z.string() });
const threadReadResultSchema = z.looseObject({
  thread: z.looseObject({
    status: z.looseObject({ type: z.string() }),
    environments: z.array(z.looseObject({ cwd: z.string() })).nullish(),
    updatedAt: z.number().nullish(),
  }),
});
const loadedListSchema = z.looseObject({ data: z.array(z.string()) });

export async function runCodexWake(deps: CodexWakeDeps, agentId: string): Promise<CodexWakeOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agent = agentsRepo.findAgent(deps.db, agentId);
  if (agent?.harness !== "codex") {
    return { kind: "not_codex" };
  }
  if (messagesRepo.listUndeliveredForRecipient(deps.db, agentId, now()).length === 0) {
    return { kind: "nothing_pending" };
  }
  let conn: RpcConnection;
  try {
    conn = await deps.connect();
  } catch (error) {
    return fallback(deps, agentId, `app-server daemon not reachable (${describe(error)})`);
  }
  try {
    const init = initializeResultSchema.parse(
      await conn.request("initialize", { clientInfo: CLIENT_INFO }),
    );
    conn.notify("initialized");
    const gateOpen = gateOpenForVersion(versionFromUserAgent(init.userAgent));
    const deadline = now() + deps.waitMs;
    for (;;) {
      const found = gateOpen ? await findThread(conn, agent) : null;
      const threadId = found?.threadId ?? null;
      const threadStatus = found?.status ?? "unknown";
      const plan = planWake({ gateOpen, threadId, threadStatus, requestId: 0, text: "" });
      if (plan.kind === "fallback") {
        return fallback(deps, agentId, plan.reason);
      }
      if (plan.kind === "wait" || threadId === null) {
        if (now() >= deadline) {
          deps.status(`codex-wake: ${agentId} is still busy; its messages stay queued for the next turn`);
          return { kind: "busy", threadId: threadId ?? "" };
        }
        await sleep(deps.pollMs ?? DEFAULT_POLL_MS);
        continue;
      }
      return await startTurn(deps, conn, agentId, threadId, now());
    }
  } catch (error) {
    return fallback(deps, agentId, describe(error));
  } finally {
    conn.close();
  }
}

/**
 * Claim the pending messages for this thread (guarded, so a concurrent wake or
 * inbox call cannot also claim them), then `turn/start` with their lines. If
 * the turn is refused, the claimed messages go back to `sent`.
 */
async function startTurn(
  deps: CodexWakeDeps,
  conn: RpcConnection,
  agentId: string,
  threadId: string,
  at: number,
): Promise<CodexWakeOutcome> {
  const claimed: MessageRow[] = [];
  for (const message of messagesRepo.listUndeliveredForRecipient(deps.db, agentId, at)) {
    if (deliverMessage(deps.db, message, at, threadId)) {
      claimed.push(message);
    }
  }
  if (claimed.length === 0) {
    return { kind: "nothing_pending" };
  }
  const text = claimed.map((m) => formatDrainLine(m, "monitor")).join("\n");
  const request = buildTurnStart(0, threadId, text);
  try {
    await conn.request(request.method, request.params);
  } catch (error) {
    // Requeue every unread delivery to this thread: the claimed ones, plus any
    // earlier ones the session never read (re-sending those is the safe side).
    messagesRepo.requeueDeliveredToSession(deps.db, agentId, threadId);
    return fallback(deps, agentId, `turn/start refused (${describe(error)})`);
  }
  deps.status(`codex-wake: woke ${agentId} with ${String(claimed.length)} message(s)`);
  return { kind: "woken", delivered: claimed.length, threadId };
}

interface FoundThread {
  threadId: string;
  status: ThreadStatus;
}

/**
 * The live thread to wake. First the thread the agent's SessionStart hook
 * recorded. Codex fires SessionStart only at a session's FIRST turn (verified),
 * so a freshly opened, never-used session has none, and a recorded one may
 * belong to a session since closed. Then ask the daemon: the loaded thread
 * whose folder is this agent's (same folder name, inside the same repo), most
 * recently updated first. Returns null when nothing live matches.
 */
async function findThread(conn: RpcConnection, agent: AgentRow): Promise<FoundThread | null> {
  if (agent.native_session !== null) {
    const recorded = await readThread(conn, agent.native_session);
    if (recorded !== null && isLive(recorded.status)) {
      return { threadId: agent.native_session, status: recorded.status };
    }
  }
  const loaded = loadedListSchema.parse(await conn.request("thread/loaded/list", {}));
  let best: (FoundThread & { updatedAt: number }) | null = null;
  for (const threadId of loaded.data) {
    const info = await readThread(conn, threadId);
    if (info === null || !isLive(info.status) || !inAgentFolder(info.cwd, agent)) {
      continue;
    }
    if (best === null || info.updatedAt > best.updatedAt) {
      best = { threadId, status: info.status, updatedAt: info.updatedAt };
    }
  }
  return best === null ? null : { threadId: best.threadId, status: best.status };
}

function isLive(status: ThreadStatus): boolean {
  return status === "idle" || status === "active";
}

function inAgentFolder(cwd: string | null, agent: AgentRow): boolean {
  if (cwd === null || basename(cwd) !== agent.folder) {
    return false;
  }
  return cwd === agent.repo_root || cwd.startsWith(`${agent.repo_root}/`);
}

async function readThread(
  conn: RpcConnection,
  threadId: string,
): Promise<{ status: ThreadStatus; cwd: string | null; updatedAt: number } | null> {
  try {
    const { thread } = threadReadResultSchema.parse(await conn.request("thread/read", { threadId }));
    const type = thread.status.type;
    const status: ThreadStatus = type === "idle" || type === "active" || type === "notLoaded" ? type : "unknown";
    return { status, cwd: thread.environments?.[0]?.cwd ?? null, updatedAt: thread.updatedAt ?? 0 };
  } catch (error) {
    if (error instanceof RpcError) {
      return null; // e.g. "thread not found": the session is gone
    }
    throw error;
  }
}

function fallback(deps: CodexWakeDeps, agentId: string, reason: string): CodexWakeOutcome {
  deps.status(`codex-wake: ${agentId} not woken (${reason}); its messages stay queued`);
  return { kind: "fallback", reason };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
