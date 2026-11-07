import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  messagesRepo,
  messageEventsRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";
import type { Db } from "../../src/store/db.js";
import type { InsertMessageInput } from "../../src/store/repos/messages-repo.js";

function setup(db: Db): { threadId: string } {
  const threadId = randomUUID();
  threadsRepo.createThread(db, {
    id: threadId,
    repoRoot: "/repo",
    title: null,
    status: "open",
    messageCap: 20,
    createdAt: 1_000,
  });
  return { threadId };
}

function msgInput(
  threadId: string,
  overrides: Partial<InsertMessageInput> = {},
): InsertMessageInput {
  return {
    id: randomUUID(),
    threadId,
    fromAgent: "a@repo",
    toAgent: "b@repo",
    kind: "text",
    body: "hello",
    payloadJson: null,
    replyTo: null,
    status: "sent",
    sentAt: 1_000,
    expiresAt: 1_000 + 24 * 60 * 60 * 1000,
    idempotencyKey: randomUUID(),
    estTokens: 2,
    ...overrides,
  };
}

describe("message status moves", () => {
  it("moves sent -> delivered -> read -> replied", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));

    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "delivered",
        at: 2_000,
        deliveredSession: "s1",
      }),
    ).toBe(true);
    expect(messagesRepo.getMessage(db, m.id).status).toBe("delivered");
    expect(messagesRepo.getMessage(db, m.id).delivered_session).toBe("s1");

    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, { status: "read", at: 3_000 }),
    ).toBe(true);
    expect(messagesRepo.getMessage(db, m.id).status).toBe("read");

    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, { status: "replied", at: 4_000 }),
    ).toBe(true);
    expect(messagesRepo.getMessage(db, m.id).status).toBe("replied");
    db.close();
  });

  it("moves sent -> failed", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));
    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "failed",
        at: 2_000,
        errorCode: "stopped",
      }),
    ).toBe(true);
    const after = messagesRepo.getMessage(db, m.id);
    expect(after.status).toBe("failed");
    expect(after.error_code).toBe("stopped");
    db.close();
  });

  it("guarded updates are no-ops when repeated or from wrong state", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));
    messagesRepo.guardedStatusUpdate(db, m.id, {
      status: "delivered",
      at: 2_000,
    });
    // repeat same transition on already-delivered message (guard: needs sent)
    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "delivered",
        at: 3_000,
      }),
    ).toBe(false);
    // a reply implies read (PLAN 4.3): delivered may jump straight to replied
    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "replied",
        at: 3_000,
      }),
    ).toBe(true);
    const repliedDirect = messagesRepo.getMessage(db, m.id);
    expect(repliedDirect.status).toBe("replied");
    expect(repliedDirect.replied_at).toBe(3_000);
    expect(repliedDirect.read_at).toBe(3_000);
    db.close();
  });

  it("a reply after read keeps the earlier read_at (reply implies read, not re-read)", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));
    messagesRepo.guardedStatusUpdate(db, m.id, {
      status: "delivered",
      at: 2_000,
      deliveredSession: "s1",
    });
    messagesRepo.guardedStatusUpdate(db, m.id, { status: "read", at: 3_000 });
    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "replied",
        at: 4_000,
      }),
    ).toBe(true);
    const after = messagesRepo.getMessage(db, m.id);
    expect(after.status).toBe("replied");
    expect(after.replied_at).toBe(4_000);
    expect(after.read_at).toBe(3_000);
    // failed (from sent) is still a no-op on a replied message
    expect(
      messagesRepo.guardedStatusUpdate(db, m.id, {
        status: "failed",
        at: 5_000,
        errorCode: "x",
      }),
    ).toBe(false);
    expect(messagesRepo.getMessage(db, m.id).status).toBe("replied");
    db.close();
  });

  it("requeues delivered unread messages when a session ends", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));
    messagesRepo.guardedStatusUpdate(db, m.id, {
      status: "delivered",
      at: 2_000,
      deliveredSession: "old-session",
    });
    const changed = messagesRepo.requeueDeliveredForSession(
      db,
      "b@repo",
      "new-session",
    );
    expect(changed).toBe(1);
    const after = messagesRepo.getMessage(db, m.id);
    expect(after.status).toBe("sent");
    expect(after.delivered_at).toBeNull();
    expect(after.delivered_session).toBeNull();
    db.close();
  });

  it("requeueDeliveredToSession requeues only the ending session's deliveries", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const a = messagesRepo.insertMessage(db, msgInput(threadId));
    const b = messagesRepo.insertMessage(db, msgInput(threadId));
    messagesRepo.guardedStatusUpdate(db, a.id, {
      status: "delivered",
      at: 2_000,
      deliveredSession: "sess-A",
    });
    messagesRepo.guardedStatusUpdate(db, b.id, {
      status: "delivered",
      at: 2_000,
      deliveredSession: "sess-B",
    });
    // Ending session A requeues only A's message.
    const changed = messagesRepo.requeueDeliveredToSession(db, "b@repo", "sess-A");
    expect(changed).toBe(1);
    expect(messagesRepo.getMessage(db, a.id).status).toBe("sent");
    expect(messagesRepo.getMessage(db, b.id).status).toBe("delivered");
    expect(messagesRepo.getMessage(db, b.id).delivered_session).toBe("sess-B");
    db.close();
  });

  it("expires sent messages after their expiry time", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(
      db,
      msgInput(threadId, { expiresAt: 5_000 }),
    );
    expect(messagesRepo.expireSentMessages(db, 4_999)).toBe(0);
    expect(messagesRepo.expireSentMessages(db, 5_000)).toBe(1);
    const after = messagesRepo.getMessage(db, m.id);
    expect(after.status).toBe("failed");
    expect(after.error_code).toBe("expired");
    db.close();
  });
});

describe("idempotent sends", () => {
  it("returns the stored message on retry with same key, never a duplicate", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const input = msgInput(threadId, { idempotencyKey: "k1" });
    const first = messagesRepo.insertMessageIdempotent(db, input);
    expect(first.created).toBe(true);
    const second = messagesRepo.insertMessageIdempotent(db, {
      ...input,
      id: randomUUID(),
      body: "different body ignored",
    });
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.body).toBe("hello");
    expect(messagesRepo.listThreadMessages(db, threadId)).toHaveLength(1);
    db.close();
  });

  it("returns current status on idempotent retry", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const input = msgInput(threadId, { idempotencyKey: "k2" });
    const first = messagesRepo.insertMessageIdempotent(db, input);
    messagesRepo.guardedStatusUpdate(db, first.message.id, {
      status: "delivered",
      at: 2_000,
    });
    const retry = messagesRepo.insertMessageIdempotent(db, {
      ...input,
      id: randomUUID(),
    });
    expect(retry.message.status).toBe("delivered");
    db.close();
  });
});

describe("message events", () => {
  it("records and lists events", () => {
    const db = openMemoryDb();
    const { threadId } = setup(db);
    const m = messagesRepo.insertMessage(db, msgInput(threadId));
    messageEventsRepo.insertMessageEvent(db, {
      id: randomUUID(),
      messageId: m.id,
      event: "sent",
      at: 1_000,
      detailJson: null,
    });
    expect(messageEventsRepo.listMessageEvents(db, m.id)).toHaveLength(1);
    db.close();
  });
});
