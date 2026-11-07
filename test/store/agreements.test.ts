import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  agreementsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";
import type { Db } from "../../src/store/db.js";
import type { AgreementStatus } from "../../src/store/schema.js";

const DEFAULT_THREADS = {
  repoRoot: "/repo",
  title: null,
  status: "open" as const,
  messageCap: 20,
  createdAt: 1_000,
};

interface Setup {
  db: Db;
  threadId: string;
}

function setupThreadWithParticipants(): Setup {
  const db = openMemoryDb();
  const threadId = randomUUID();
  threadsRepo.createThread(db, { id: threadId, ...DEFAULT_THREADS });
  // a@r has talked to b@r in this thread, so both are thread participants.
  messagesRepo.insertMessage(db, {
    id: randomUUID(),
    threadId,
    fromAgent: "a@r",
    toAgent: "b@r",
    kind: "text",
    body: "shall we split the migration work?",
    payloadJson: null,
    replyTo: null,
    status: "delivered",
    sentAt: 1_100,
    expiresAt: 100_000,
    idempotencyKey: randomUUID(),
    estTokens: 8,
  });
  return { db, threadId };
}

type OfferOverrides = Partial<Parameters<typeof agreementsRepo.insertAgreement>[1]>;

function offer(setup: Setup, overrides: OfferOverrides = {}) {
  const id = randomUUID();
  agreementsRepo.insertAgreement(setup.db, {
    id,
    threadId: setup.threadId,
    repoRoot: "/repo",
    text: "a@r implements the migration",
    status: "offered",
    offeredBy: "a@r",
    // b@r is the agreement's recipient (a@r sent them a message in the thread).
    offeredTo: "b@r",
    answeredBy: null,
    parentId: null,
    createdAt: 2_000,
    answeredAt: null,
    ...overrides,
  });
  return agreementsRepo.getAgreement(setup.db, id);
}

function attempt(
  setup: Setup,
  agreementId: string,
  status: AgreementStatus,
  answeredBy: string,
  answeredAt: number,
) {
  return agreementsRepo.updateAgreementStatus(
    setup.db,
    agreementId,
    status,
    answeredBy,
    answeredAt,
  );
}

describe("agreement lifecycle", () => {
  it("records offered -> accepted by the recipient", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    expect(offered.status).toBe("offered");
    expect(offered.answered_by).toBeNull();

    // The recipient answers directly through the store; the guard accepts it.
    expect(attempt(setup, offered.id, "accepted", "b@r", 3_000)).toBe(true);
    const accepted = agreementsRepo.getAgreement(setup.db, offered.id);
    expect(accepted.status).toBe("accepted");
    expect(accepted.answered_by).toBe("b@r");
    expect(accepted.answered_at).toBe(3_000);
    setup.db.close();
  });

  it("lets the recipient counter instead", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    expect(attempt(setup, offered.id, "countered", "b@r", 3_000)).toBe(true);
    const countered = agreementsRepo.getAgreement(setup.db, offered.id);
    expect(countered.status).toBe("countered");
    expect(countered.answered_by).toBe("b@r");
    setup.db.close();
  });

  it("lets the recipient reject", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    expect(attempt(setup, offered.id, "rejected", "b@r", 3_000)).toBe(true);
    expect(agreementsRepo.getAgreement(setup.db, offered.id).status).toBe(
      "rejected",
    );
    setup.db.close();
  });

  it("refuses the update attempt when the offerer tries to answer their own offer", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    // The forbidden update is actually attempted: a@r (the offerer) answers.
    expect(attempt(setup, offered.id, "accepted", "a@r", 3_000)).toBe(false);
    expect(agreementsRepo.getAgreement(setup.db, offered.id).status).toBe(
      "offered",
    );
    expect(agreementsRepo.getAgreement(setup.db, offered.id).answered_by).toBeNull();
    setup.db.close();
  });

  it("refuses the update attempt by an agent that is not a thread participant", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    // c@r takes part in no message of this thread, so they are not the
    // agreement's recipient.
    expect(attempt(setup, offered.id, "accepted", "c@r", 3_000)).toBe(false);
    const row = agreementsRepo.getAgreement(setup.db, offered.id);
    expect(row.status).toBe("offered");
    expect(row.answered_by).toBeNull();
    setup.db.close();
  });

  it("refuses an agent that is a thread participant but not the agreement's recipient", () => {
    const setup = setupThreadWithParticipants();
    // c@r joins the same thread by messaging a@r, so c@r is a participant...
    messagesRepo.insertMessage(setup.db, {
      id: randomUUID(),
      threadId: setup.threadId,
      fromAgent: "c@r",
      toAgent: "a@r",
      kind: "text",
      body: "I can take the tests",
      payloadJson: null,
      replyTo: null,
      status: "delivered",
      sentAt: 1_200,
      expiresAt: 100_000,
      idempotencyKey: randomUUID(),
      estTokens: 6,
    });
    // ...but the offer was made to b@r (offered_to = 'b@r'), so c@r may not
    // answer it even though they take part in the thread.
    const offered = offer(setup);
    expect(offered.offered_to).toBe("b@r");
    expect(attempt(setup, offered.id, "accepted", "c@r", 3_000)).toBe(false);
    const row = agreementsRepo.getAgreement(setup.db, offered.id);
    expect(row.status).toBe("offered");
    expect(row.answered_by).toBeNull();
    // The real recipient b@r still succeeds.
    expect(attempt(setup, offered.id, "accepted", "b@r", 3_500)).toBe(true);
    expect(agreementsRepo.getAgreement(setup.db, offered.id).status).toBe(
      "accepted",
    );
    setup.db.close();
  });

  it("refuses the update attempt on a settled agreement", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    expect(attempt(setup, offered.id, "accepted", "b@r", 3_000)).toBe(true);
    // Too late: the agreement is no longer `offered`.
    expect(attempt(setup, offered.id, "rejected", "b@r", 4_000)).toBe(false);
    const row = agreementsRepo.getAgreement(setup.db, offered.id);
    expect(row.status).toBe("accepted");
    expect(row.answered_by).toBe("b@r");
    expect(row.answered_at).toBe(3_000);
    setup.db.close();
  });

  it("keeps counter-proposals linked to their parent agreement", () => {
    const setup = setupThreadWithParticipants();
    const offered = offer(setup);
    const parentResp = attempt(setup, offered.id, "countered", "b@r", 3_000);
    expect(parentResp).toBe(true);
    const counter = offer(setup, {
      text: "b@r implements it on Thursday",
      status: "offered",
      offeredBy: "b@r",
      // A counter by b@r is offered back to the original offerer, a@r.
      offeredTo: "a@r",
      parentId: offered.id,
      createdAt: 3_100,
    });
    expect(counter.parent_id).toBe(offered.id);
    expect(counter.status).toBe("offered");
    // The original offerer may answer the counter-proposal.
    expect(attempt(setup, counter.id, "accepted", "a@r", 4_000)).toBe(true);
    setup.db.close();
  });
});
