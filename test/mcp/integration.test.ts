import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { Db } from "../../src/store/db.js";
import {
  agreementsRepo,
  openMemoryDb,
  messagesRepo,
} from "../../src/store/index.js";
import { createServer } from "../../src/mcp/server.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { applyRetention } from "../../src/store/retention.js";
import { retentionCutoff } from "../../src/core/retention.js";

const REPO_ROOT = "/repo";

function linkedPair(): [InMemoryTransport, InMemoryTransport] {
  return InMemoryTransport.createLinkedPair();
}

async function startServer(db: Db, agentId: string): Promise<Client> {
  const [clientTransport, serverTransport] = linkedPair();
  registerCaller(db, agentId, REPO_ROOT, null, Date.now());
  const server = createServer({
    db,
    agentId,
    repoRoot: REPO_ROOT,
    nativeSession: null,
    rulesTextSent: false,
  });
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP integration (SDK in-memory transport, two fake agents)", () => {
  it("round-trips a message through talk and inbox", async () => {
    const db = openMemoryDb();
    applyRetention(db, retentionCutoff(Date.now()));
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");

    // A sends a message to B in a new thread.
    await clientA.callTool({
      name: "talk",
      arguments: {
        to: "b@r",
        text: "shall we split the migration work?",
        idempotency_key: "k1",
      },
    });

    // B has a pending (sent) message.
    const pending = messagesRepo.listUndeliveredForRecipient(db, "b@r", Date.now());
    const firstPending = pending[0];
    if (!firstPending) {
      throw new Error("expected a pending message for b@r");
    }
    expect(pending).toHaveLength(1);
    expect(firstPending.status).toBe("sent");
    expect(firstPending.body).toBe("shall we split the migration work?");
    const threadId = firstPending.thread_id;

    // B reads inbox: sent -> delivered -> read.
    await clientB.callTool({ name: "inbox", arguments: {} });

    // No more undelivered messages for B.
    const stillPending = messagesRepo.listUndeliveredForRecipient(db, "b@r", Date.now());
    expect(stillPending).toHaveLength(0);

    // The message is now read.
    const all = messagesRepo.listThreadMessages(db, threadId);
    const firstAll = all[0];
    if (!firstAll) {
      throw new Error("expected a message in the thread");
    }
    expect(firstAll.status).toBe("read");

    db.close();
  });

  it("an agreement is offered by A and accepted by B", async () => {
    const db = openMemoryDb();
    applyRetention(db, retentionCutoff(Date.now()));
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");

    // A sends a message to B to establish a thread + recipient.
    await clientA.callTool({
      name: "talk",
      arguments: {
        to: "b@r",
        text: "can you take this?",
        idempotency_key: "k2",
      },
    });
    const pending = messagesRepo.listUndeliveredForRecipient(db, "b@r", Date.now());
    const firstPending = pending[0];
    if (!firstPending) {
      throw new Error("expected a pending message for b@r");
    }
    const threadId = firstPending.thread_id;

    // A offers an agreement.
    await clientA.callTool({
      name: "agree",
      arguments: { action: "offer", thread_id: threadId, text: "a@r implements the migration" },
    });

    const agreements = agreementsRepo.listAgreementsByRepo(db, REPO_ROOT);
    expect(agreements).toHaveLength(1);
    const offered = agreements[0];
    if (!offered) {
      throw new Error("expected an offered agreement");
    }
    expect(offered.status).toBe("offered");
    expect(offered.offered_by).toBe("a@r");
    const agreementId = offered.id;

    // B accepts.
    await clientB.callTool({
      name: "agree",
      arguments: { action: "accept", agreement_id: agreementId },
    });

    const updated = agreementsRepo.getAgreement(db, agreementId);
    expect(updated.status).toBe("accepted");
    expect(updated.answered_by).toBe("b@r");

    db.close();
  });

  it("lists exactly the three Parley tools", async () => {
    const db = openMemoryDb();
    const clientA = await startServer(db, "a@r");
    const toolNames = (await clientA.listTools()).tools.map((t) => t.name);
    expect(toolNames).toContain("talk");
    expect(toolNames).toContain("inbox");
    expect(toolNames).toContain("agree");
    expect(toolNames).toHaveLength(3);
    db.close();
  });
});
