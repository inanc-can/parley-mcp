import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { retentionCutoff } from "../../src/core/retention.js";
import {
  agreementsRepo,
  applyRetention,
  editsRepo,
  messageEventsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";

describe("30-day retention", () => {
  it("computes the cutoff", () => {
    const now = 30 * 24 * 60 * 60 * 1000 + 1_000;
    expect(retentionCutoff(now)).toBe(1_000);
  });

  it("deletes messages, events, agreements and edits older than 30 days", () => {
    const db = openMemoryDb();
    const now = 100 * 24 * 60 * 60 * 1000;
    const cutoff = retentionCutoff(now);
    const old = cutoff - 1;
    const recent = cutoff + 1;

    const threadId = randomUUID();
    threadsRepo.createThread(db, {
      id: threadId,
      repoRoot: "/repo",
      title: null,
      status: "open",
      messageCap: 20,
      createdAt: old,
    });

    const oldMsg = randomUUID();
    messagesRepo.insertMessage(db, {
      id: oldMsg,
      threadId,
      fromAgent: "a@r",
      toAgent: "b@r",
      kind: "text",
      body: "old",
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: old,
      expiresAt: old + 24 * 60 * 60 * 1000,
      idempotencyKey: randomUUID(),
      estTokens: 1,
    });
    messageEventsRepo.insertMessageEvent(db, {
      id: randomUUID(),
      messageId: oldMsg,
      event: "sent",
      at: old,
      detailJson: null,
    });

    const newMsg = randomUUID();
    messagesRepo.insertMessage(db, {
      id: newMsg,
      threadId,
      fromAgent: "a@r",
      toAgent: "b@r",
      kind: "text",
      body: "new",
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: recent,
      expiresAt: recent + 24 * 60 * 60 * 1000,
      idempotencyKey: randomUUID(),
      estTokens: 1,
    });
    messageEventsRepo.insertMessageEvent(db, {
      id: randomUUID(),
      messageId: newMsg,
      event: "sent",
      at: recent,
      detailJson: null,
    });

    agreementsRepo.insertAgreement(db, {
      id: randomUUID(),
      threadId,
      repoRoot: "/repo",
      text: "old agreement",
      status: "offered",
      offeredBy: "a@r",
      offeredTo: "b@r",
      answeredBy: null,
      parentId: null,
      createdAt: old,
      answeredAt: null,
    });
    agreementsRepo.insertAgreement(db, {
      id: randomUUID(),
      threadId,
      repoRoot: "/repo",
      text: "new agreement",
      status: "offered",
      offeredBy: "a@r",
      offeredTo: "b@r",
      answeredBy: null,
      parentId: null,
      createdAt: recent,
      answeredAt: null,
    });

    editsRepo.insertEdit(db, {
      id: randomUUID(),
      repoRoot: "/repo",
      agentId: "a@r",
      path: "old.ts",
      at: old,
    });
    editsRepo.insertEdit(db, {
      id: randomUUID(),
      repoRoot: "/repo",
      agentId: "a@r",
      path: "new.ts",
      at: recent,
    });

    const result = applyRetention(db, cutoff);
    expect(result.events).toBe(1);
    expect(result.messages).toBe(1);
    expect(result.agreements).toBe(1);
    expect(result.edits).toBe(1);

    expect(messagesRepo.findMessage(db, oldMsg)).toBeUndefined();
    expect(messagesRepo.findMessage(db, newMsg)?.body).toBe("new");
    expect(messageEventsRepo.listMessageEvents(db, oldMsg)).toHaveLength(0);
    expect(messageEventsRepo.listMessageEvents(db, newMsg)).toHaveLength(1);
    expect(agreementsRepo.listAgreementsByRepo(db, "/repo")).toHaveLength(1);
    db.close();
  });

  it("succeeds when a message older than the cutoff has a newer event", () => {
    const db = openMemoryDb();
    const now = 100 * 24 * 60 * 60 * 1000;
    const cutoff = retentionCutoff(now);
    const old = cutoff - 1;
    const recent = cutoff + 10_000;

    const threadId = randomUUID();
    threadsRepo.createThread(db, {
      id: threadId,
      repoRoot: "/repo",
      title: null,
      status: "open",
      messageCap: 20,
      createdAt: old,
    });
    const oldMsg = randomUUID();
    messagesRepo.insertMessage(db, {
      id: oldMsg,
      threadId,
      fromAgent: "a@r",
      toAgent: "b@r",
      kind: "text",
      body: "old but recently touched",
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: old,
      expiresAt: recent,
      idempotencyKey: randomUUID(),
      estTokens: 1,
    });
    // Event newer than the cutoff (e.g. an expiry event) on a message older
    // than the cutoff; retention must still delete both.
    messageEventsRepo.insertMessageEvent(db, {
      id: randomUUID(),
      messageId: oldMsg,
      event: "expired",
      at: recent,
      detailJson: null,
    });

    const result = applyRetention(db, cutoff);
    expect(result.messages).toBe(1);
    expect(result.events).toBe(1);
    expect(messagesRepo.findMessage(db, oldMsg)).toBeUndefined();
    expect(messageEventsRepo.listMessageEvents(db, oldMsg)).toHaveLength(0);
    db.close();
  });
});
