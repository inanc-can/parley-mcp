import { beforeEach, describe, expect, it } from "vitest";
import { RpcError, type RpcConnection } from "../../src/adapters/codex/control-socket.js";
import { runCodexWake, type CodexWakeDeps } from "../../src/cli/commands/codex-wake.js";
import { handleTalk } from "../../src/mcp/tools/talk.js";
import { registerCaller } from "../../src/mcp/identity.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { agentsRepo, messagesRepo, openMemoryDb, type Db } from "../../src/store/index.js";

const REPO = "/repo";
const THREAD = "01a1b7df-83c8-7940-9f19-56aa6d37b6e7";
const TUI_AGENT = "codex-tui/0.154.0 (Ubuntu 24.4.0; x86_64) linux (mcp-parley; 0)";

interface Call {
  method: string;
  params: Record<string, unknown>;
}

/** A fake daemon connection: answers from a script and records every call. */
interface ExtraThread {
  id: string;
  cwd: string;
  status: string;
  updatedAt: number;
}

function fakeDaemon(opts: {
  userAgent?: string;
  statuses?: string[];
  turnStart?: "ok" | "refuse";
  readError?: boolean;
  /** Other loaded threads, discoverable through thread/loaded/list. */
  others?: ExtraThread[];
}): { conn: RpcConnection; calls: Call[]; closed: () => boolean } {
  const calls: Call[] = [];
  const statuses = [...(opts.statuses ?? ["idle"])];
  const others = opts.others ?? [];
  let closed = false;
  const conn: RpcConnection = {
    request(method, params) {
      calls.push({ method, params });
      if (method === "initialize") {
        return Promise.resolve({ userAgent: opts.userAgent ?? TUI_AGENT });
      }
      if (method === "thread/loaded/list") {
        return Promise.resolve({ data: [THREAD, ...others.map((t) => t.id)], nextCursor: null });
      }
      if (method === "thread/read") {
        const other = others.find((t) => t.id === params["threadId"]);
        if (other !== undefined) {
          return Promise.resolve({
            thread: { id: other.id, status: { type: other.status }, environments: [{ cwd: other.cwd }], updatedAt: other.updatedAt },
          });
        }
        if (opts.readError === true) {
          return Promise.reject(new RpcError(method, -32600, "thread not found"));
        }
        const type = statuses.length > 1 ? statuses.shift() : statuses[0];
        return Promise.resolve({
          thread: { id: THREAD, status: { type }, environments: [{ cwd: "/repo/api" }], updatedAt: 10 },
        });
      }
      if (method === "turn/start") {
        return opts.turnStart === "refuse"
          ? Promise.reject(new RpcError(method, -32600, "thread not found"))
          : Promise.resolve({ turn: { id: "turn-1", status: "inProgress" } });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    },
    notify(method) {
      calls.push({ method, params: {} });
    },
    close() {
      closed = true;
    },
  };
  return { conn, calls, closed: () => closed };
}

let db: Db;
let clock = 1_000_000;

function deps(conn: RpcConnection | Error, extra: Partial<CodexWakeDeps> = {}): CodexWakeDeps {
  return {
    db,
    connect: () => (conn instanceof Error ? Promise.reject(conn) : Promise.resolve(conn)),
    status: () => undefined,
    waitMs: 2000,
    pollMs: 100,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    ...extra,
  };
}

async function send(text: string, to = "codex@api"): Promise<string> {
  const ctx: ToolContext = { db, agentId: "claude@web", repoRoot: REPO, nativeSession: null, rulesTextSent: false };
  const outcome = await handleTalk(ctx, { to, text, idempotency_key: `k-${text}` }, clock);
  const ids = messagesRepo.listUndeliveredForRecipient(db, to, clock).map((m) => m.id);
  expect(outcome).toBeDefined();
  return ids[ids.length - 1] ?? "";
}

function statusOf(id: string): string {
  return messagesRepo.getMessage(db, id).status;
}

beforeEach(() => {
  db = openMemoryDb();
  clock = 1_000_000;
  registerCaller(db, "claude@web", REPO, "claude-session", clock);
  registerCaller(db, "codex@api", REPO, THREAD, clock);
});

describe("codex-wake on an idle thread", () => {
  it("turn/starts the thread with the message line and marks it delivered to that thread", async () => {
    const id = await send("can you take the login bug?");
    const daemon = fakeDaemon({ statuses: ["idle"] });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");

    expect(outcome).toEqual({ kind: "woken", delivered: 1, threadId: THREAD });
    const turn = daemon.calls.find((c) => c.method === "turn/start");
    expect(turn?.params["threadId"]).toBe(THREAD);
    // The id rides in the prompt so the UserPromptSubmit hook can mark it read.
    expect(JSON.stringify(turn?.params["input"])).toContain(id);
    expect(JSON.stringify(turn?.params["input"])).toContain("reply_to");
    expect(statusOf(id)).toBe("delivered");
    expect(messagesRepo.getMessage(db, id).delivered_session).toBe(THREAD);
    expect(daemon.calls[0]?.method).toBe("initialize");
    expect(daemon.closed()).toBe(true);
  });

  it("does nothing (and never connects) when nothing is pending", async () => {
    let connected = false;
    const outcome = await runCodexWake(
      deps(new Error("unused"), {
        connect: () => {
          connected = true;
          return Promise.reject(new Error("should not connect"));
        },
      }),
      "codex@api",
    );
    expect(outcome.kind).toBe("nothing_pending");
    expect(connected).toBe(false);
  });

  it("ignores agents that are not Codex", async () => {
    await send("hello", "claude@web");
    const outcome = await runCodexWake(deps(fakeDaemon({}).conn), "claude@web");
    expect(outcome.kind).toBe("not_codex");
  });
});

describe("codex-wake on a busy thread", () => {
  it("waits for the turn to end, then starts a turn (never steers)", async () => {
    const id = await send("ping");
    const daemon = fakeDaemon({ statuses: ["active", "active", "idle"] });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");

    expect(outcome.kind).toBe("woken");
    expect(daemon.calls.filter((c) => c.method === "thread/read")).toHaveLength(3);
    expect(daemon.calls.some((c) => c.method === "turn/steer")).toBe(false);
    expect(statusOf(id)).toBe("delivered");
  });

  it("leaves the message queued when the turn outlasts the wait", async () => {
    const id = await send("ping");
    const daemon = fakeDaemon({ statuses: ["active"] });
    const outcome = await runCodexWake(deps(daemon.conn, { waitMs: 300 }), "codex@api");

    expect(outcome.kind).toBe("busy");
    expect(daemon.calls.some((c) => c.method === "turn/start")).toBe(false);
    expect(statusOf(id)).toBe("sent");
  });
});

describe("codex-wake fails closed", () => {
  it("queues when the daemon is not running", async () => {
    const id = await send("ping");
    const outcome = await runCodexWake(deps(new Error("ENOENT")), "codex@api");
    expect(outcome.kind).toBe("fallback");
    expect(statusOf(id)).toBe("sent");
  });

  it("queues on an unverified protocol version, without touching the thread", async () => {
    const id = await send("ping");
    const daemon = fakeDaemon({ userAgent: "codex-tui/0.160.0 (x) linux" });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");
    expect(outcome.kind).toBe("fallback");
    expect(daemon.calls.some((c) => c.method === "thread/read" || c.method === "turn/start")).toBe(false);
    expect(statusOf(id)).toBe("sent");
  });

  it("queues when the session was closed (thread not loaded) and never resumes it", async () => {
    const id = await send("ping");
    const daemon = fakeDaemon({ statuses: ["notLoaded"] });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");
    expect(outcome.kind).toBe("fallback");
    expect(daemon.calls.some((c) => c.method === "thread/resume" || c.method === "turn/start")).toBe(false);
    expect(statusOf(id)).toBe("sent");
  });

  it("treats a thread/read error as a closed session", async () => {
    const id = await send("ping");
    const outcome = await runCodexWake(deps(fakeDaemon({ readError: true }).conn), "codex@api");
    expect(outcome.kind).toBe("fallback");
    expect(statusOf(id)).toBe("sent");
  });

  it("puts claimed messages back to sent when turn/start is refused", async () => {
    const id = await send("ping");
    const daemon = fakeDaemon({ statuses: ["idle"], turnStart: "refuse" });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");
    expect(outcome.kind).toBe("fallback");
    expect(statusOf(id)).toBe("sent");
  });

  it("queues when the agent has no known thread yet", async () => {
    registerCaller(db, "codex@docs", REPO, null, clock);
    const id = await send("ping", "codex@docs");
    const daemon = fakeDaemon({});
    const outcome = await runCodexWake(deps(daemon.conn), "codex@docs");
    expect(outcome.kind).toBe("fallback");
    expect(statusOf(id)).toBe("sent");
  });
});

describe("talk starts a Codex wake", () => {
  function ctxWith(wakes: string[], answer: boolean): ToolContext {
    return {
      db,
      agentId: "claude@web",
      repoRoot: REPO,
      nativeSession: null,
      rulesTextSent: false,
      wakeRecipient: (agentId, harness) => {
        wakes.push(`${agentId}:${harness}`);
        return answer;
      },
    };
  }

  it("asks for a wake for a queued message and says so honestly in the outlook", async () => {
    const wakes: string[] = [];
    const outcome = await handleTalk(ctxWith(wakes, true), { to: "codex@api", text: "hi", idempotency_key: "w1" }, clock);
    expect(wakes).toEqual(["codex@api:codex"]);
    expect(JSON.stringify(outcome)).toContain("waking its Codex session");
    expect(JSON.stringify(outcome)).toContain("otherwise the message is queued");
  });

  it("keeps the ordinary outlook when no wake was started", async () => {
    const wakes: string[] = [];
    const outcome = await handleTalk(ctxWith(wakes, false), { to: "codex@api", text: "hi", idempotency_key: "w2" }, clock);
    expect(wakes).toEqual(["codex@api:codex"]);
    expect(JSON.stringify(outcome)).not.toContain("waking");
  });

  it("does not wake again for an idempotent retry of an already delivered message", async () => {
    const wakes: string[] = [];
    const ctx = ctxWith(wakes, true);
    await handleTalk(ctx, { to: "codex@api", text: "hi", idempotency_key: "w3" }, clock);
    for (const m of messagesRepo.listUndeliveredForRecipient(db, "codex@api", clock)) {
      messagesRepo.guardedStatusUpdate(db, m.id, { status: "delivered", at: clock, deliveredSession: THREAD });
    }
    await handleTalk(ctx, { to: "codex@api", text: "hi", idempotency_key: "w3" }, clock);
    expect(wakes).toHaveLength(1);
  });
});

describe("a Codex tool call keeps the hook-recorded thread id", () => {
  it("does not erase native_session when the MCP server has no session id", async () => {
    const ctx: ToolContext = { db, agentId: "codex@api", repoRoot: REPO, nativeSession: null, rulesTextSent: false };
    await handleTalk(ctx, { to: "claude@web", text: "hi", idempotency_key: "keep" }, clock + 5);
    const agent = agentsRepo.findAgent(db, "codex@api");
    expect(agent?.native_session).toBe(THREAD);
    expect(agent?.last_heartbeat).toBe(clock + 5);
  });
});

describe("codex-wake finds the thread when SessionStart has not recorded it", () => {
  const FRESH = "01a1b7e5-f94e-7da0-9f70-15979ba1e2ae";

  it("wakes the loaded thread in the agent's folder when no thread was recorded", async () => {
    registerCaller(db, "codex@docs", REPO, null, clock);
    const id = await send("ping", "codex@docs");
    const daemon = fakeDaemon({
      others: [
        { id: "elsewhere", cwd: "/other-repo/docs", status: "idle", updatedAt: 99 },
        { id: FRESH, cwd: "/repo/docs", status: "idle", updatedAt: 50 },
      ],
    });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@docs");
    expect(outcome).toEqual({ kind: "woken", delivered: 1, threadId: FRESH });
    expect(messagesRepo.getMessage(db, id).delivered_session).toBe(FRESH);
  });

  it("moves past a recorded thread whose session was closed", async () => {
    await send("ping");
    const daemon = fakeDaemon({
      statuses: ["notLoaded"],
      others: [{ id: FRESH, cwd: "/repo/api", status: "idle", updatedAt: 50 }],
    });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");
    expect(outcome).toEqual({ kind: "woken", delivered: 1, threadId: FRESH });
  });

  it("prefers the most recently updated of two sessions in one folder", async () => {
    await send("ping");
    const daemon = fakeDaemon({
      statuses: ["notLoaded"],
      others: [
        { id: "older", cwd: "/repo/api", status: "idle", updatedAt: 20 },
        { id: FRESH, cwd: "/repo/api", status: "idle", updatedAt: 80 },
      ],
    });
    const outcome = await runCodexWake(deps(daemon.conn), "codex@api");
    expect(outcome.kind === "woken" ? outcome.threadId : "").toBe(FRESH);
  });
});
