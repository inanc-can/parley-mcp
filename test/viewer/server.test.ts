import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { z } from "zod";
import { registerCaller } from "../../src/mcp/identity.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { handleAgree } from "../../src/mcp/tools/agree.js";
import { handleTalk } from "../../src/mcp/tools/talk.js";
import { agreementsRepo, messagesRepo, openMemoryDb, settingsRepo, threadsRepo, type Db } from "../../src/store/index.js";
import { defaultStaticDir, startViewer, type ViewerHandle } from "../../src/viewer/server.js";

const REPO = "/repo";
let db: Db;
let viewer: ViewerHandle;
const wakes: string[] = [];

function ctx(agentId: string): ToolContext {
  return { db, agentId, repoRoot: REPO, nativeSession: null, rulesTextSent: false };
}

async function startThread(): Promise<string> {
  await handleTalk(ctx("claude@web"), { to: "codex@api", text: "can you take the login bug?", idempotency_key: "t1" });
  const thread = threadsRepo.listThreadsByRepo(db, REPO)[0];
  if (thread === undefined) {
    throw new Error("no thread");
  }
  return thread.id;
}

function base(): string {
  return `http://127.0.0.1:${String(viewer.port)}`;
}

async function call(path: string, init: RequestInit = {}, withToken = true): Promise<{ status: number; json: unknown }> {
  const headers = new Headers(init.headers);
  if (withToken) {
    headers.set("x-parley-token", viewer.token);
  }
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (static files, export)
  }
  return { status: res.status, json };
}

function post(path: string, body: unknown = {}): Promise<{ status: number; json: unknown }> {
  return call(path, { method: "POST", body: JSON.stringify(body) });
}

const stateSchema = z.object({
  stopAll: z.boolean(),
  agents: z.array(z.object({ id: z.string(), alive: z.boolean() })),
  threads: z.array(z.object({ id: z.string(), status: z.string(), messageCount: z.number(), messageCap: z.number(), estTokens: z.number() })),
});
const threadSchema = z.object({
  thread: z.object({ status: z.string(), messageCap: z.number() }),
  messages: z.array(z.object({ from: z.string(), to: z.string(), body: z.string(), status: z.string() })),
  agreements: z.array(z.object({ id: z.string(), status: z.string() })),
});
const errorSchema = z.object({ error: z.string() });

beforeEach(async () => {
  db = openMemoryDb();
  wakes.length = 0;
  registerCaller(db, "claude@web", REPO, "claude-session", Date.now());
  registerCaller(db, "codex@api", REPO, null, Date.now());
  viewer = await startViewer({
    db,
    repoRoot: REPO,
    pollMs: 30,
    staticDir: defaultStaticDir(),
    wakeRecipient: (agentId, harness) => {
      wakes.push(`${agentId}:${harness}`);
      return true;
    },
    exportLines: (format) => [`export ${format}`],
  });
});

afterEach(async () => {
  await viewer.close();
  db.close();
});

describe("viewer access control", () => {
  it("binds to 127.0.0.1 and prints a URL carrying the token", () => {
    expect(viewer.url).toBe(`http://127.0.0.1:${String(viewer.port)}/?token=${viewer.token}`);
    expect(viewer.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("rejects requests without the token, or with a wrong one", async () => {
    expect((await call("/api/state", {}, false)).status).toBe(403);
    expect((await call("/api/state", { headers: { "x-parley-token": "nope" } }, false)).status).toBe(403);
    expect((await call(`/api/state?token=${viewer.token}`, {}, false)).status).toBe(200);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: viewer.port, path: `/api/state?token=${viewer.token}`, headers: { Host: "evil.example:80" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("serves the page with a strict content security policy", async () => {
    const res = await fetch(`${base()}/?token=${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toContain('<script src="app.js"');
  });

  it("serves the page's code and styles without the token (they hold no data), but not the page or data", async () => {
    const css = await fetch(`${base()}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect((await call("/", {}, false)).status).toBe(403);
    expect((await call("/api/threads/x", {}, false)).status).toBe(403);
  });
});

describe("viewer state and threads", () => {
  it("lists agents and threads with receipts, counts and token estimates", async () => {
    const threadId = await startThread();
    const state = stateSchema.parse((await call("/api/state")).json);
    expect(state.agents.map((a) => a.id).sort()).toEqual(["claude@web", "codex@api"]);
    expect(state.threads[0]).toMatchObject({ id: threadId, status: "open", messageCount: 1, messageCap: 20 });
    expect(state.threads[0]?.estTokens).toBeGreaterThan(0);
    const view = threadSchema.parse((await call(`/api/threads/${threadId}`)).json);
    expect(view.messages[0]).toMatchObject({ from: "claude@web", to: "codex@api", status: "sent" });
  });

  it("404s for a thread in another repo", async () => {
    await handleTalk(
      { ...ctx("claude@web"), repoRoot: "/other" },
      { to: "codex@api", text: "elsewhere", idempotency_key: "o1" },
    );
    const other = threadsRepo.listThreadsByRepo(db, "/other")[0];
    expect((await call(`/api/threads/${other?.id ?? ""}`)).status).toBe(404);
  });
});

describe("posting as you", () => {
  it("sends one message per participant from `you` and wakes them", async () => {
    const threadId = await startThread();
    const res = await post(`/api/threads/${threadId}/messages`, { text: "please both look at auth.ts", idempotency_key: "h1" });
    expect(res.status).toBe(200);
    const fromYou = messagesRepo.listThreadMessages(db, threadId).filter((m) => m.from_agent === "you");
    expect(fromYou.map((m) => m.to_agent).sort()).toEqual(["claude@web", "codex@api"]);
    expect(fromYou.every((m) => m.status === "sent")).toBe(true);
    expect(wakes.sort()).toEqual(["claude@web:claude", "codex@api:codex"]);
    // Retrying with the same key does not duplicate.
    await post(`/api/threads/${threadId}/messages`, { text: "please both look at auth.ts", idempotency_key: "h1" });
    expect(messagesRepo.listThreadMessages(db, threadId).filter((m) => m.from_agent === "you")).toHaveLength(2);
  });

  it("blocks secrets and refuses closed threads", async () => {
    const threadId = await startThread();
    const secret = await post(`/api/threads/${threadId}/messages`, { text: "key AKIAABCDEFGHIJKLMNOP" });
    expect(secret.status).toBe(400);
    expect(errorSchema.parse(secret.json).error).toBe("secret_blocked");
    await post(`/api/threads/${threadId}/close`);
    const closed = await post(`/api/threads/${threadId}/messages`, { text: "hello?" });
    expect(closed.status).toBe(409);
  });
});

describe("pause, resume and stop-all", () => {
  it("pauses a thread so agents are refused, and resume adds 20 messages", async () => {
    const threadId = await startThread();
    expect((await post(`/api/threads/${threadId}/pause`)).status).toBe(200);
    const refused = await handleTalk(ctx("codex@api"), { to: "claude@web", text: "on it", thread_id: threadId, idempotency_key: "p1" });
    expect(JSON.stringify(refused)).toContain("thread_paused");
    expect((await post(`/api/threads/${threadId}/pause`)).status).toBe(409);
    expect((await post(`/api/threads/${threadId}/resume`)).status).toBe(200);
    const view = threadSchema.parse((await call(`/api/threads/${threadId}`)).json);
    expect(view.thread).toMatchObject({ status: "open", messageCap: 40 });
  });

  it("stop-all blocks every talk call until turned off", async () => {
    expect((await post("/api/stop-all", { on: true })).status).toBe(200);
    expect(settingsRepo.getStopAll(db)).toBe(true);
    const refused = await handleTalk(ctx("claude@web"), { to: "codex@api", text: "hi", idempotency_key: "s1" });
    expect(JSON.stringify(refused)).toContain("stop_all");
    await post("/api/stop-all", { on: false });
    expect(stateSchema.parse((await call("/api/state")).json).stopAll).toBe(false);
    expect((await post("/api/stop-all", { on: "yes" })).status).toBe(400);
  });
});

describe("veto", () => {
  it("vetoes only accepted agreements and tells both agents", async () => {
    const threadId = await startThread();
    handleAgree(ctx("claude@web"), { action: "offer", thread_id: threadId, text: "codex owns src/auth/**" });
    const offered = agreementsRepo.listAgreementsByThread(db, threadId)[0];
    if (offered === undefined) {
      throw new Error("no agreement");
    }
    expect((await post(`/api/agreements/${offered.id}/veto`)).status).toBe(409);
    handleAgree(ctx("codex@api"), { action: "accept", agreement_id: offered.id });
    expect((await post(`/api/agreements/${offered.id}/veto`)).status).toBe(200);
    expect(agreementsRepo.getAgreement(db, offered.id).status).toBe("vetoed");
    const notices = messagesRepo.listThreadMessages(db, threadId).filter((m) => m.from_agent === "system");
    expect(notices.map((m) => m.to_agent).sort()).toEqual(["claude@web", "codex@api"]);
    expect(notices[0]?.body).toContain("vetoed");
    expect((await post(`/api/agreements/${offered.id}/veto`)).status).toBe(409);
  });
});

describe("live updates over SSE", () => {
  it("pushes a change event when another process writes a message", async () => {
    const threadId = await startThread();
    const controller = new AbortController();
    const res = await fetch(`${base()}/api/events?token=${viewer.token}`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (reader === undefined) {
      throw new Error("no stream");
    }
    const decoder = new TextDecoder();
    let seen = "";
    const readUntil = async (needle: string): Promise<void> => {
      while (!seen.includes(needle)) {
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error(`stream ended before ${needle}`);
        }
        const bytes: unknown = chunk.value;
        seen += bytes instanceof Uint8Array ? decoder.decode(bytes) : "";
      }
    };
    await readUntil("event: ready");
    // An agent replies from "another process": straight into the shared db.
    await handleTalk(ctx("codex@api"), { to: "claude@web", text: "taking it", thread_id: threadId, idempotency_key: "r1" });
    await readUntil("event: change");
    controller.abort();
  });
});

describe("export", () => {
  it("downloads md and jsonl and rejects other formats", async () => {
    const res = await fetch(`${base()}/api/export?format=md&token=${viewer.token}`);
    expect(res.headers.get("content-disposition")).toContain("parley-export.md");
    expect(await res.text()).toBe("export md\n");
    expect((await call("/api/export?format=pdf")).status).toBe(400);
  });
});
