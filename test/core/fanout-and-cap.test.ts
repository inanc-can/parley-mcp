import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { expandEveryone } from "../../src/core/message-rules.js";
import {
  checkThreadPostable,
  DEFAULT_MESSAGE_CAP,
} from "../../src/core/threads.js";
import {
  messagesRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";

describe("everyone fan-out", () => {
  it("expands to one recipient per agent except sender, sharing idempotency base", () => {
    const recipients = expandEveryone(
      ["a@r", "b@r", "c@r"],
      "a@r",
      "k1",
    );
    expect(recipients).toHaveLength(2);
    expect(recipients.map((r) => r.toAgent).sort()).toEqual(["b@r", "c@r"]);
    expect(new Set(recipients.map((r) => r.idempotencyKey)).size).toBe(2);
  });

  it("creates one message row per recipient in the same thread", () => {
    const db = openMemoryDb();
    const threadId = randomUUID();
    threadsRepo.createThread(db, {
      id: threadId,
      repoRoot: "/repo",
      title: null,
      status: "open",
      messageCap: 20,
      createdAt: 1,
    });
    const fanout = expandEveryone(["a@r", "b@r", "c@r"], "a@r", "broadcast-1");
    for (const entry of fanout) {
      messagesRepo.insertMessageIdempotent(db, {
        id: randomUUID(),
        threadId,
        fromAgent: "a@r",
        toAgent: entry.toAgent,
        kind: "text",
        body: "hi everyone",
        payloadJson: null,
        replyTo: null,
        status: "sent",
        sentAt: 1,
        expiresAt: 100_000,
        idempotencyKey: entry.idempotencyKey,
        estTokens: 3,
      });
    }
    const rows = messagesRepo.listThreadMessages(db, threadId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.thread_id === threadId)).toBe(true);
    expect(rows.map((r) => r.to_agent).sort()).toEqual(["b@r", "c@r"]);
    db.close();
  });
});

describe("cap -> paused", () => {
  it("returns thread_paused when count reaches cap or thread is paused", () => {
    const base = {
      id: "t",
      repo_root: "/r",
      title: null,
      message_cap: 20,
      created_at: 1,
    };
    expect(checkThreadPostable({ ...base, status: "open" }, 19)).toEqual({
      ok: true,
    });
    expect(checkThreadPostable({ ...base, status: "open" }, 20)).toEqual({
      ok: false,
      code: "thread_paused",
    });
    expect(checkThreadPostable({ ...base, status: "paused" }, 0)).toEqual({
      ok: false,
      code: "thread_paused",
    });
  });

  it("pauses a thread when it reaches its message cap via enforceMessageCap", () => {
    expect(DEFAULT_MESSAGE_CAP).toBe(20);
    const db = openMemoryDb();
    const threadId = randomUUID();
    threadsRepo.createThread(db, {
      id: threadId,
      repoRoot: "/repo",
      title: null,
      status: "open",
      messageCap: DEFAULT_MESSAGE_CAP,
      createdAt: 1,
    });
    for (let i = 0; i < DEFAULT_MESSAGE_CAP; i += 1) {
      messagesRepo.insertMessage(db, {
        id: randomUUID(),
        threadId,
        fromAgent: "a@r",
        toAgent: "b@r",
        kind: "text",
        body: `m${String(i)}`,
        payloadJson: null,
        replyTo: null,
        status: "sent",
        sentAt: i,
        expiresAt: 100_000,
        idempotencyKey: randomUUID(),
        estTokens: 1,
      });
    }
    const count = threadsRepo.countThreadMessages(db, threadId);
    expect(count).toBe(DEFAULT_MESSAGE_CAP);

    // Production composition of count + cap + pause; the test does not pause
    // the thread itself.
    const thread = threadsRepo.enforceMessageCap(db, threadId);
    expect(thread.status).toBe("paused");
    expect(threadsRepo.getThread(db, threadId).status).toBe("paused");
    expect(checkThreadPostable(thread, count)).toEqual({
      ok: false,
      code: "thread_paused",
    });
    db.close();
  });

  it("keeps an open thread below its cap open", () => {
    const db = openMemoryDb();
    const threadId = randomUUID();
    threadsRepo.createThread(db, {
      id: threadId,
      repoRoot: "/repo",
      title: null,
      status: "open",
      messageCap: DEFAULT_MESSAGE_CAP,
      createdAt: 1,
    });
    messagesRepo.insertMessage(db, {
      id: randomUUID(),
      threadId,
      fromAgent: "a@r",
      toAgent: "b@r",
      kind: "text",
      body: "one message",
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: 1,
      expiresAt: 100_000,
      idempotencyKey: randomUUID(),
      estTokens: 1,
    });
    const thread = threadsRepo.enforceMessageCap(db, threadId);
    expect(thread.status).toBe("open");
    db.close();
  });
});
