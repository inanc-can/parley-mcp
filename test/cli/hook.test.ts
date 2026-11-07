import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  agentsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
  type Db,
} from "../../src/store/index.js";
import {
  runHookPostTool,
  runHookSessionEnd,
  runHookSessionStart,
  runHookStop,
  runHookUserPrompt,
} from "../../src/cli/commands/hook-events.js";

const REPO = "/repo";
const CWD = "/repo/api";
const AGENT = "claude@api";

function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function db(): Db {
  return openMemoryDb();
}

function seedMessageTo(database: Db, to: string, status: "sent" | "delivered"): string {
  const threadId = randomUUID();
  threadsRepo.createThread(database, {
    id: threadId,
    repoRoot: REPO,
    title: "t",
    status: "open",
    messageCap: 20,
    createdAt: 1_000,
  });
  const id = randomUUID();
  messagesRepo.insertMessage(database, {
    id,
    threadId,
    fromAgent: "codex@api",
    toAgent: to,
    kind: "text",
    body: "hi",
    payloadJson: null,
    replyTo: null,
    status: "sent",
    sentAt: 1_100,
    expiresAt: 10_000_000_000_000,
    idempotencyKey: randomUUID(),
    estTokens: 4,
  });
  if (status === "delivered") {
    messagesRepo.guardedStatusUpdate(database, id, {
      status: "delivered",
      at: 1_200,
      deliveredSession: "sess-old",
    });
  }
  return id;
}

describe("subagent payloads are ignored", () => {
  it("is ignored by every hook handler", () => {
    const database = db();
    const base = { session_id: "s1", cwd: CWD, agent_type: "Explore" };
    const out = collector();

    runHookSessionStart({ db: database, repoRoot: REPO, write: out.write }, { ...base });
    runHookUserPrompt(
      { db: database, repoRoot: REPO, write: out.write },
      { ...base, prompt: "anything" },
    );
    runHookStop({ db: database, repoRoot: REPO, write: out.write }, { ...base });
    runHookPostTool({ db: database, repoRoot: REPO, write: out.write }, { ...base });
    const requeued = runHookSessionEnd({ db: database, repoRoot: REPO, write: out.write }, { ...base });

    // No agent was registered and nothing was requeued.
    expect(agentsRepo.findAgent(database, AGENT)).toBeUndefined();
    expect(requeued).toBe(0);
    expect(out.lines.every((l) => l.includes("ignored subagent payload"))).toBe(true);
    database.close();
  });

  it("is also ignored when only agent_id is present", () => {
    const database = db();
    const out = collector();
    runHookSessionStart(
      { db: database, repoRoot: REPO, write: out.write },
      { session_id: "s1", cwd: CWD, agent_id: "sub-123" },
    );
    expect(agentsRepo.findAgent(database, AGENT)).toBeUndefined();
    database.close();
  });
});

describe("session-start", () => {
  it("registers the agent from the cwd basename", () => {
    const database = db();
    const out = collector();
    runHookSessionStart(
      { db: database, repoRoot: REPO, write: out.write, now: 5_000 },
      { session_id: "sess-1", cwd: CWD },
    );
    const agent = agentsRepo.findAgent(database, AGENT);
    expect(agent?.id).toBe(AGENT);
    expect(agent?.repo_root).toBe(REPO);
    expect(agent?.native_session).toBe("sess-1");
    expect(agent?.last_heartbeat).toBe(5_000);
    database.close();
  });
});

describe("user-prompt read evidence", () => {
  it("marks a delivered message read when its id appears in the prompt", () => {
    const database = db();
    const out = collector();
    const id = seedMessageTo(database, AGENT, "delivered");

    const read = runHookUserPrompt(
      { db: database, repoRoot: REPO, write: out.write, now: 6_000 },
      { session_id: "sess-2", cwd: CWD, prompt: `Got your message ${id}, on it.` },
    );
    expect(read).toBe(1);
    expect(messagesRepo.getMessage(database, id).status).toBe("read");
    database.close();
  });

  it("does not mark read when the id is absent from the prompt", () => {
    const database = db();
    const out = collector();
    const id = seedMessageTo(database, AGENT, "delivered");

    const read = runHookUserPrompt(
      { db: database, repoRoot: REPO, write: out.write, now: 6_000 },
      { session_id: "sess-2", cwd: CWD, prompt: "unrelated prompt" },
    );
    expect(read).toBe(0);
    expect(messagesRepo.getMessage(database, id).status).toBe("delivered");
    database.close();
  });

  it("delivers then reads a still-sent message seen in the prompt", () => {
    const database = db();
    const out = collector();
    const id = seedMessageTo(database, AGENT, "sent");

    const read = runHookUserPrompt(
      { db: database, repoRoot: REPO, write: out.write, now: 6_000 },
      { session_id: "sess-2", cwd: CWD, prompt: `re: ${id}` },
    );
    expect(read).toBe(1);
    expect(messagesRepo.getMessage(database, id).status).toBe("read");
    database.close();
  });
});

describe("post-tool", () => {
  it("drains pending messages and records an Edit", () => {
    const database = db();
    const out = collector();
    agentsRepo.upsertAgent(database, {
      id: AGENT,
      harness: "claude",
      folder: "api",
      repoRoot: REPO,
      nativeSession: "sess-3",
      lastHeartbeat: 1_000,
      createdAt: 1_000,
    });
    const id = seedMessageTo(database, AGENT, "sent");

    runHookPostTool(
      { db: database, repoRoot: REPO, write: out.write, now: 7_000 },
      {
        session_id: "sess-3",
        cwd: CWD,
        tool_name: "Edit",
        tool_input: { file_path: "/repo/api/src/x.ts" },
      },
    );
    expect(messagesRepo.getMessage(database, id).status).toBe("delivered");
    expect(out.lines.join("\n")).toContain("edit recorded");
    database.close();
  });
});

describe("session-end requeue", () => {
  it("requeues a delivered-but-unread message back to sent", () => {
    const database = db();
    const out = collector();
    const id = seedMessageTo(database, AGENT, "delivered");

    const requeued = runHookSessionEnd(
      { db: database, repoRoot: REPO, write: out.write },
      { session_id: "sess-old", cwd: CWD, reason: "other" },
    );
    expect(requeued).toBe(1);
    expect(messagesRepo.getMessage(database, id).status).toBe("sent");
    database.close();
  });
});
