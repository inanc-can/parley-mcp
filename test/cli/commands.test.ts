import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentsRepo,
  agreementsRepo,
  claimsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
  type Db,
} from "../../src/store/index.js";
import { runWho } from "../../src/cli/commands/who.js";
import { runLog } from "../../src/cli/commands/log.js";
import { runExport } from "../../src/cli/commands/export.js";
import {
  runInboxDrain,
  runInboxRegister,
  runInboxWatchOnce,
} from "../../src/cli/commands/inbox.js";
import { runHookEdit } from "../../src/cli/commands/hook.js";
import { runServe } from "../../src/cli/commands/serve.js";
import type { ServeHandle, ServeOptions } from "../../src/mcp/server.js";

const REPO = "/repo";

function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function seedThread(db: Db): string {
  const threadId = randomUUID();
  threadsRepo.createThread(db, {
    id: threadId,
    repoRoot: REPO,
    title: "split the work",
    status: "open",
    messageCap: 20,
    createdAt: 1_000,
  });
  return threadId;
}

function seedMessage(db: Db, threadId: string, from: string, to: string, body: string): string {
  const id = randomUUID();
  messagesRepo.insertMessage(db, {
    id,
    threadId,
    fromAgent: from,
    toAgent: to,
    kind: "text",
    body,
    payloadJson: null,
    replyTo: null,
    status: "sent",
    sentAt: 1_100,
    expiresAt: 10_000_000_000_000,
    idempotencyKey: randomUUID(),
    estTokens: 4,
  });
  return id;
}

describe("cli who", () => {
  it("marks agents alive or idle", () => {
    const db = openMemoryDb();
    const now = 1_000_000;
    agentsRepo.upsertAgent(db, {
      id: "a@repo",
      harness: "a",
      folder: "repo",
      repoRoot: REPO,
      nativeSession: null,
      lastHeartbeat: now - 1_000,
      createdAt: 0,
    });
    agentsRepo.upsertAgent(db, {
      id: "b@repo",
      harness: "b",
      folder: "repo",
      repoRoot: REPO,
      nativeSession: null,
      lastHeartbeat: now - 60_000,
      createdAt: 0,
    });
    const out = collector();
    runWho({ db, repoRoot: REPO, write: out.write, now });
    const text = out.lines.join("\n");
    expect(text).toContain("a@repo  [alive]");
    expect(text).toContain("b@repo  [idle]");
    db.close();
  });

  it("reports when there are no agents", () => {
    const db = openMemoryDb();
    const out = collector();
    runWho({ db, repoRoot: REPO, write: out.write });
    expect(out.lines).toEqual(["No agents in this repo yet."]);
    db.close();
  });
});

describe("cli log", () => {
  it("lists threads and prints a conversation", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    seedMessage(db, threadId, "a@repo", "b@repo", "hello there");

    const list = collector();
    runLog({ db, repoRoot: REPO, write: list.write });
    expect(list.lines.join("\n")).toContain(threadId);

    const one = collector();
    runLog({ db, repoRoot: REPO, write: one.write, threadId });
    const text = one.lines.join("\n");
    expect(text).toContain("hello there");
    expect(text).toContain("a@repo -> b@repo");
    db.close();
  });

  it("refuses a thread from another repo", () => {
    const db = openMemoryDb();
    const out = collector();
    runLog({ db, repoRoot: REPO, write: out.write, threadId: "missing" });
    expect(out.lines).toEqual(["No thread missing in this repo."]);
    db.close();
  });
});

describe("cli export", () => {
  it("exports markdown with messages and decisions", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    seedMessage(db, threadId, "a@repo", "b@repo", "shall we agree?");
    const agreementId = randomUUID();
    agreementsRepo.insertAgreement(db, {
      id: agreementId,
      threadId,
      repoRoot: REPO,
      text: "a does the migration",
      status: "accepted",
      offeredBy: "a@repo",
      offeredTo: "b@repo",
      answeredBy: "b@repo",
      parentId: null,
      createdAt: 2_000,
      answeredAt: 3_000,
    });
    const out = collector();
    runExport({ db, repoRoot: REPO, write: out.write, format: "md" });
    const text = out.lines.join("\n");
    expect(text).toContain("# Parley conversations");
    expect(text).toContain("shall we agree?");
    expect(text).toContain("a does the migration");
    db.close();
  });

  it("exports jsonl: one parseable object per line", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    seedMessage(db, threadId, "a@repo", "b@repo", "jsonl please");
    const out = collector();
    runExport({ db, repoRoot: REPO, write: out.write, format: "jsonl" });
    const typedRow = z.object({ type: z.string() });
    const types = out.lines.map((line) => typedRow.parse(JSON.parse(line)).type);
    expect(types).toContain("thread");
    expect(types).toContain("message");
    db.close();
  });
});

describe("cli inbox (adapter commands)", () => {
  it("drains pending messages, marking them delivered (never read)", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    const msgId = seedMessage(db, threadId, "a@repo", "b@repo", "wake up");

    const monitor = collector();
    const count = runInboxDrain(
      { db, repoRoot: REPO, write: monitor.write, now: 1_200 },
      "b@repo",
      "monitor",
      "sess-1",
    );
    expect(count).toBe(1);
    expect(monitor.lines[0]).toContain("parley: a@repo");
    const after = messagesRepo.getMessage(db, msgId);
    expect(after.status).toBe("delivered");
    expect(after.delivered_session).toBe("sess-1");

    // A second drain finds nothing (already delivered).
    const again = collector();
    expect(
      runInboxDrain({ db, repoRoot: REPO, write: again.write, now: 1_300 }, "b@repo", "json", null),
    ).toBe(0);
    db.close();
  });

  it("drains json format as a parseable object", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    seedMessage(db, threadId, "a@repo", "b@repo", "structured");
    const out = collector();
    runInboxDrain({ db, repoRoot: REPO, write: out.write, now: 1_200 }, "b@repo", "json", null);
    const first = out.lines[0];
    if (first === undefined) {
      throw new Error("expected a drained line");
    }
    const row = z.object({ from_agent: z.string(), body: z.string() }).parse(JSON.parse(first));
    expect(row.from_agent).toBe("a@repo");
    expect(row.body).toBe("structured");
    db.close();
  });

  it("watch --once returns the first message then reports none", () => {
    const db = openMemoryDb();
    const threadId = seedThread(db);
    seedMessage(db, threadId, "a@repo", "b@repo", "one");
    const out = collector();
    const first = runInboxWatchOnce(
      { db, repoRoot: REPO, write: out.write, now: 1_200 },
      "b@repo",
      "monitor",
      null,
    );
    expect(first.found).toBe(true);
    const second = runInboxWatchOnce(
      { db, repoRoot: REPO, write: out.write, now: 1_300 },
      "b@repo",
      "monitor",
      null,
    );
    expect(second.found).toBe(false);
    db.close();
  });

  it("registers an agent and stamps a heartbeat", () => {
    const db = openMemoryDb();
    const out = collector();
    runInboxRegister(
      { db, repoRoot: REPO, write: out.write, now: 5_000 },
      "codex@repo",
      "native-1",
    );
    const agent = agentsRepo.getAgent(db, "codex@repo");
    expect(agent.harness).toBe("codex");
    expect(agent.folder).toBe("repo");
    expect(agent.last_heartbeat).toBe(5_000);
    expect(agent.native_session).toBe("native-1");
    expect(out.lines[0]).toContain("registered codex@repo");
    db.close();
  });
});

describe("cli hook edit", () => {
  it("records an edit and warns about another agent's active claim", () => {
    const db = openMemoryDb();
    // b@repo claims the file; a@repo then edits it and is warned.
    claimsRepo.insertClaim(db, {
      id: randomUUID(),
      repoRoot: REPO,
      agentId: "b@repo",
      pathGlob: "src/app.ts",
      expiresAt: 10_000_000,
    });
    const out = collector();
    const conflicts = runHookEdit(
      { db, repoRoot: REPO, write: out.write, now: 1_000 },
      "a@repo",
      "src/app.ts",
    );
    expect(conflicts).toBe(1);
    expect(out.lines.join("\n")).toContain("overlap warning");
    db.close();
  });

  it("records an edit with no overlap", () => {
    const db = openMemoryDb();
    const out = collector();
    const conflicts = runHookEdit(
      { db, repoRoot: REPO, write: out.write, now: 1_000 },
      "a@repo",
      "src/lonely.ts",
    );
    expect(conflicts).toBe(0);
    expect(out.lines.join("\n")).toContain("no overlap");
    db.close();
  });
});

describe("cli serve command", () => {
  it("resolves options and hands off to the serve entry point", async () => {
    let captured: ServeOptions | undefined;
    const handle: ServeHandle = { isClosed: () => false, close: () => undefined };
    const result = await runServe({
      env: { PARLEY_AGENT_ID: "codex@repo", PARLEY_DB_PATH: "/tmp/hub.db" },
      cwd: "/repo",
      start: (options) => {
        captured = options;
        return Promise.resolve(handle);
      },
    });
    expect(result).toBe(handle);
    expect(captured?.agentIdEnv).toBe("codex@repo");
    expect(captured?.dbPath).toBe("/tmp/hub.db");
    expect(captured?.repoRoot).toBeTypeOf("string");
  });
});
