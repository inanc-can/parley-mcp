import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { runHookEdit } from "../../src/cli/commands/hook.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { createServer } from "../../src/mcp/server.js";
import type { Notice } from "../../src/notify/os-notify.js";
import { agreementsRepo, claimsRepo, messagesRepo, openMemoryDb, threadsRepo, type Db } from "../../src/store/index.js";

/**
 * M7's check (PLAN section 10): a scripted conversation hits the cap, pauses
 * and triggers a notification; a message with a fake ghp_ token is blocked;
 * the rules reminder appears when .parley/rules.md exists. Driven through the
 * real MCP server over the SDK's in-memory transport.
 */

let db: Db;
let repo: string;
let notices: Notice[];

const talkResult = z.object({ thread_id: z.string(), message_id: z.string(), status: z.string() });
const refusal = z.object({ error: z.string(), detail: z.string() });

async function agent(id: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  registerCaller(db, id, repo, null, Date.now());
  const server = createServer({
    db,
    agentId: id,
    repoRoot: repo,
    nativeSession: null,
    rulesTextSent: false,
    notify: (n) => notices.push(n),
  });
  await server.connect(serverSide);
  const client = new Client({ name: "m7", version: "0" });
  await client.connect(clientSide);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return JSON.stringify(result.content);
}

beforeEach(() => {
  db = openMemoryDb();
  repo = mkdtempSync(join(tmpdir(), "parley-m7-"));
  notices = [];
});

afterEach(() => {
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

describe("loop guard end to end", () => {
  it("pauses a thread at its 20-message cap, notifies the human once and refuses the 21st", async () => {
    const a = await agent("claude@web");
    const b = await agent("codex@api");
    let threadId: string | undefined;
    for (let i = 1; i <= 20; i += 1) {
      const [from, to] = i % 2 === 1 ? [a, "codex@api"] : [b, "claude@web"];
      const result = await from.callTool({
        name: "talk",
        arguments: { to, text: `round ${String(i)}: still disagreeing`, idempotency_key: `k${String(i)}`, ...(threadId ? { thread_id: threadId } : {}) },
      });
      expect(result.isError).not.toBe(true);
      threadId = talkResult.parse(result.structuredContent).thread_id;
    }
    if (threadId === undefined) {
      throw new Error("no thread");
    }
    expect(threadsRepo.getThread(db, threadId).status).toBe("paused");
    expect(notices.filter((n) => n.kind === "paused")).toHaveLength(1);
    expect(notices[0]?.body).toContain("round 1");

    const extra = await a.callTool({
      name: "talk",
      arguments: { to: "codex@api", text: "one more", thread_id: threadId, idempotency_key: "k21" },
    });
    expect(refusal.parse(extra.structuredContent).error).toBe("thread_paused");
    expect(notices.filter((n) => n.kind === "paused")).toHaveLength(1);
  });

  it("blocks a message carrying a fake GitHub token and never echoes it", async () => {
    const a = await agent("claude@web");
    await agent("codex@api");
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0".repeat(2)}`;
    const result = await a.callTool({
      name: "talk",
      arguments: { to: "codex@api", text: `use this: ${token}`, idempotency_key: "s1" },
    });
    expect(refusal.parse(result.structuredContent).error).toBe("secret_blocked");
    expect(text(result)).not.toContain(token);
    expect(messagesRepo.listUndeliveredForRecipient(db, "codex@api", Date.now())).toHaveLength(0);
  });
});

describe("rules file", () => {
  it("adds the reminder to talk and inbox, and inbox returns the text once per session", async () => {
    mkdirSync(join(repo, ".parley"));
    writeFileSync(join(repo, ".parley", "rules.md"), "Never share customer data between agents.\n");
    const a = await agent("claude@web");
    const b = await agent("codex@api");
    const sent = await a.callTool({ name: "talk", arguments: { to: "codex@api", text: "hi", idempotency_key: "r1" } });
    expect(text(sent)).toContain(".parley/rules.md");
    const first = await b.callTool({ name: "inbox", arguments: {} });
    expect(text(first)).toContain("Never share customer data");
    const second = await b.callTool({ name: "inbox", arguments: {} });
    expect(text(second)).not.toContain("Never share customer data");
    expect(text(second)).toContain(".parley/rules.md");
  });

  it("says nothing about rules when the file does not exist", async () => {
    const a = await agent("claude@web");
    await agent("codex@api");
    const sent = await a.callTool({ name: "talk", arguments: { to: "codex@api", text: "hi", idempotency_key: "n1" } });
    expect(text(sent)).not.toContain("rules.md");
  });
});

describe("notifications for agreements and conflicts", () => {
  it("notifies when an agreement is accepted", async () => {
    const a = await agent("claude@web");
    const b = await agent("codex@api");
    const sent = talkResult.parse(
      (await a.callTool({ name: "talk", arguments: { to: "codex@api", text: "split?", idempotency_key: "g1" } })).structuredContent,
    );
    await a.callTool({ name: "agree", arguments: { action: "offer", thread_id: sent.thread_id, text: "codex owns src/auth/**" } });
    const offered = agreementsRepo.listAgreementsByThread(db, sent.thread_id)[0];
    expect(notices).toHaveLength(0);
    await b.callTool({ name: "agree", arguments: { action: "accept", agreement_id: offered?.id ?? "" } });
    expect(notices.map((n) => n.kind)).toEqual(["agreement"]);
    expect(notices[0]?.body).toContain("codex@api accepted claude@web's offer");
  });

  it("on an edit conflict, both agents get a system message in a thread named after the file, and the human is notified", () => {
    registerCaller(db, "claude@web", repo, null, Date.now());
    registerCaller(db, "codex@api", repo, null, Date.now());
    const now = Date.now();
    claimsRepo.insertClaim(db, { id: "c1", repoRoot: repo, agentId: "codex@api", pathGlob: "src/auth/**", expiresAt: now + 3_600_000 });
    const deps = { db, repoRoot: repo, status: () => undefined, now, notify: (n: Notice) => notices.push(n) };
    expect(runHookEdit(deps, "claude@web", "src/auth/login.ts")).toBe(1);
    const thread = threadsRepo.listThreadsByRepo(db, repo).find((t) => t.title === "conflict: src/auth/login.ts");
    expect(thread).toBeDefined();
    const sys = messagesRepo.listThreadMessages(db, thread?.id ?? "");
    expect(sys.map((m) => [m.from_agent, m.to_agent]).sort()).toEqual([
      ["system", "claude@web"],
      ["system", "codex@api"],
    ]);
    expect(notices.map((n) => n.kind)).toEqual(["conflict"]);
    // A second conflict on the same file reuses the open thread.
    runHookEdit({ ...deps, now: now + 1000 }, "claude@web", "src/auth/login.ts");
    expect(threadsRepo.listThreadsByRepo(db, repo).filter((t) => t.title === "conflict: src/auth/login.ts")).toHaveLength(1);
  });
});
