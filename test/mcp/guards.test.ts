import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { checkStopAll } from "../../src/core/guards.js";
import { checkThreadPostable, DEFAULT_MESSAGE_CAP } from "../../src/core/threads.js";
import { enforceMessageCap } from "../../src/mcp/guards.js";
import { checkStopAllActive } from "../../src/mcp/guards.js";
import {
  messagesRepo,
  openMemoryDb,
  settingsRepo,
  threadsRepo,
} from "../../src/store/index.js";

describe("cap -> paused (caller-layer composition)", () => {
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
    const thread = enforceMessageCap(db, threadId);
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
    const thread = enforceMessageCap(db, threadId);
    expect(thread.status).toBe("open");
    db.close();
  });
});

describe("stop-all (caller-layer composition)", () => {
  it("blocks talk while the setting is on, resumes when the human turns it off", () => {
    const db = openMemoryDb();
    expect(checkStopAllActive(db)).toEqual({ ok: true });

    settingsRepo.setStopAll(db, true);
    expect(checkStopAllActive(db)).toEqual({
      ok: false,
      code: "stop_all",
    });

    // The human resumes from the viewer.
    settingsRepo.setStopAll(db, false);
    expect(checkStopAllActive(db)).toEqual({ ok: true });
    expect(checkStopAll(settingsRepo.getStopAll(db))).toEqual({ ok: true });
    db.close();
  });
});
