import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Db } from "../../src/store/db.js";
import {
  agreementsRepo,
  claimsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
} from "../../src/store/index.js";
import { handleAgree } from "../../src/mcp/tools/agree.js";
import type { ToolContext } from "../../src/mcp/context.js";

const REPO_ROOT = "/repo";

function makeCtx(db: Db, agentId: string): ToolContext {
  return { db, agentId, repoRoot: REPO_ROOT, nativeSession: null, rulesTextSent: false };
}

function setupThread(db: Db): string {
  const threadId = randomUUID();
  threadsRepo.createThread(db, {
    id: threadId,
    repoRoot: REPO_ROOT,
    title: null,
    status: "open",
    messageCap: 20,
    createdAt: 1,
  });
  messagesRepo.insertMessage(db, {
    id: randomUUID(),
    threadId,
    fromAgent: "a@r",
    toAgent: "b@r",
    kind: "text",
    body: "can you take this?",
    payloadJson: null,
    replyTo: null,
    status: "delivered",
    sentAt: 1,
    expiresAt: 100_000,
    idempotencyKey: randomUUID(),
    estTokens: 4,
  });
  return threadId;
}

function offer(db: Db, threadId: string): string {
  return agreementsRepo.insertAgreement(db, {
    id: randomUUID(),
    threadId,
    repoRoot: REPO_ROOT,
    text: "a@r implements the migration",
    status: "offered",
    offeredBy: "a@r",
    offeredTo: "b@r",
    answeredBy: null,
    parentId: null,
    createdAt: 2_000,
    answeredAt: null,
  }).id;
}

describe("agree claim conflicts", () => {
  it("reports other agents' active overlapping claims as conflicts", () => {
    const db = openMemoryDb();
    try {
      setupThread(db);
      claimsRepo.insertClaim(db, {
        id: "c1",
        repoRoot: REPO_ROOT,
        agentId: "a@r",
        pathGlob: "src/*.ts",
        expiresAt: 100_000,
      });

      const result = handleAgree(
        makeCtx(db, "b@r"),
        { action: "claim", path_glob: "src/app.ts" },
        50_000,
      );
      expect(result.isError).not.toBe(true);
      expect(result.value).toMatchObject({
        conflicts: [{ agentId: "a@r", kind: "claim" }],
      });
      db.close();
    } catch (error) {
      db.close();
      throw error;
    }
  });

  it("does not report its own claims as conflicts", () => {
    const db = openMemoryDb();
    try {
      setupThread(db);
      claimsRepo.insertClaim(db, {
        id: "c1",
        repoRoot: REPO_ROOT,
        agentId: "b@r",
        pathGlob: "src/app.ts",
        expiresAt: 100_000,
      });

      const result = handleAgree(
        makeCtx(db, "b@r"),
        { action: "claim", path_glob: "src/app.ts" },
        50_000,
      );
      expect(result.isError).not.toBe(true);
      expect(result.value).toMatchObject({ conflicts: [] });
      db.close();
    } catch (error) {
      db.close();
      throw error;
    }
  });
});

describe("agree counter", () => {
  it("refuses a textless counter and keeps the original offered", () => {
    const db = openMemoryDb();
    try {
      const threadId = setupThread(db);
      const agreementId = offer(db, threadId);

      const result = handleAgree(
        makeCtx(db, "b@r"),
        { action: "counter", agreement_id: agreementId },
        3_000,
      );
      expect(result.isError).toBe(true);
      // No orphan: the original is still offered and no counter row exists.
      expect(agreementsRepo.getAgreement(db, agreementId).status).toBe(
        "offered",
      );
      expect(agreementsRepo.listAgreementsByRepo(db, REPO_ROOT)).toHaveLength(
        1,
      );
      db.close();
    } catch (error) {
      db.close();
      throw error;
    }
  });

  it("marks the original countered and adds a new offered counter in one transaction", () => {
    const db = openMemoryDb();
    try {
      const threadId = setupThread(db);
      const agreementId = offer(db, threadId);

      const result = handleAgree(
        makeCtx(db, "b@r"),
        { action: "counter", agreement_id: agreementId, text: "b@r implements it" },
        3_000,
      );
      expect(result.isError).not.toBe(true);
      expect(agreementsRepo.getAgreement(db, agreementId).status).toBe(
        "countered",
      );
      const agreements = agreementsRepo.listAgreementsByRepo(db, REPO_ROOT);
      expect(agreements).toHaveLength(2);
      const counter = agreements.find((agreement) => agreement.parent_id === agreementId);
      if (!counter) {
        throw new Error("expected a counter-proposal row");
      }
      expect(counter.status).toBe("offered");
      expect(counter.offered_by).toBe("b@r");
      expect(counter.offered_to).toBe("a@r");
      db.close();
    } catch (error) {
      db.close();
      throw error;
    }
  });
});
