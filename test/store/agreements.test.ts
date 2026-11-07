import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  canAnswerAgreement,
  nextAgreementStatus,
} from "../../src/core/agreements.js";
import {
  agreementsRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";
import type { Db } from "../../src/store/db.js";

const DEFAULT_THREADS = {
  repoRoot: "/repo",
  title: null,
  status: "open" as const,
  messageCap: 20,
  createdAt: 1_000,
};

function setup(db: Db): string {
  const threadId = randomUUID();
  threadsRepo.createThread(db, { id: threadId, ...DEFAULT_THREADS });
  return threadId;
}

function offer(db: Db, threadId: string, overrides = {}) {
  const id = randomUUID();
  agreementsRepo.insertAgreement(db, {
    id,
    threadId,
    repoRoot: "/repo",
    text: "a@r implements the migration",
    status: "offered",
    offeredBy: "a@r",
    answeredBy: null,
    parentId: null,
    createdAt: 2_000,
    answeredAt: null,
    ...overrides,
  });
  return agreementsRepo.getAgreement(db, id);
}

function answer(
  db: Db,
  agreementId: string,
  action: "accept" | "counter" | "reject" | "veto",
  responderId: string,
  recipientId: string,
  at: number,
) {
  expect(canAnswerAgreement("offered", responderId, recipientId)).toBe(true);
  agreementsRepo.updateAgreementStatus(
    db,
    agreementId,
    nextAgreementStatus(action),
    responderId,
    at,
  );
  return agreementsRepo.getAgreement(db, agreementId);
}

describe("agreement lifecycle", () => {
  it("records offered -> accepted by the recipient", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    expect(offered.status).toBe("offered");
    expect(offered.answered_by).toBeNull();

    const accepted = answer(db, offered.id, "accept", "b@r", "b@r", 3_000);
    expect(accepted.status).toBe("accepted");
    expect(accepted.answered_by).toBe("b@r");
    db.close();
  });

  it("lets the recipient counter instead", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    const countered = answer(db, offered.id, "counter", "b@r", "b@r", 3_000);
    expect(countered.status).toBe("countered");
    expect(countered.answered_by).toBe("b@r");
    db.close();
  });

  it("lets the recipient reject", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    const rejected = answer(db, offered.id, "reject", "b@r", "b@r", 3_000);
    expect(rejected.status).toBe("rejected");
    db.close();
  });

  it("forbids a non-recipient from answering", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    expect(canAnswerAgreement("offered", "c@r", "b@r")).toBe(false);
    // The store row stays untouched when the guard rejects the answer.
    expect(agreementsRepo.getAgreement(db, offered.id).status).toBe("offered");
    expect(agreementsRepo.getAgreement(db, offered.id).answered_by).toBeNull();
    db.close();
  });

  it("forbids answering twice: a settled agreement is no longer offered", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    answer(db, offered.id, "accept", "b@r", "b@r", 3_000);
    expect(canAnswerAgreement("accepted", "b@r", "b@r")).toBe(false);
    db.close();
  });

  it("keeps counter-proposals linked to their parent agreement", () => {
    const db = openMemoryDb();
    const threadId = setup(db);
    const offered = offer(db, threadId);
    const counter = offer(db, threadId, {
      text: "b@r implements it on Thursday",
      status: "countered",
      offeredBy: "b@r",
      parentId: offered.id,
      createdAt: 3_000,
    });
    expect(counter.parent_id).toBe(offered.id);
    expect(counter.status).toBe("countered");
    db.close();
  });
});
