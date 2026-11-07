import { describe, expect, it } from "vitest";
import { z } from "zod";
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

const TalkResult = z.object({
  message_id: z.string(),
  thread_id: z.string(),
  status: z.string(),
  outlook: z.string(),
});

const AgreementResult = z.object({
  agreement: z.object({
    agreement_id: z.string(),
    status: z.string(),
    offered_by: z.string(),
    offered_to: z.string(),
    answered_by: z.string().nullable(),
  }),
});

const InboxResult = z.object({
  messages: z.array(z.unknown()),
});

const RefusalResult = z.object({
  error: z.string(),
  detail: z.string(),
});

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

async function talk(
  client: Client,
  to: string,
  text: string,
  key: string,
  replyTo?: string,
  threadId?: string,
): Promise<{ threadId: string; messageId: string }> {
  const result = await client.callTool({
    name: "talk",
    arguments: {
      to,
      text,
      idempotency_key: key,
      ...(threadId ? { thread_id: threadId } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    },
  });
  expect(result.isError).not.toBe(true);
  const content = TalkResult.parse(result.structuredContent);
  expect(content.status).toBe("sent");
  return { threadId: content.thread_id, messageId: content.message_id };
}

describe("MCP integration (SDK in-memory transport, two fake agents)", () => {
  it("round-trips a message and a reply moves the original to replied", async () => {
    const db = openMemoryDb();
    applyRetention(db, retentionCutoff(Date.now()));
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");

    // A sends a message to B in a new thread.
    const { threadId, messageId } = await talk(
      clientA,
      "b@r",
      "shall we split the migration work?",
      "k1",
    );

    // B has a pending (sent) message.
    const pending = messagesRepo.listUndeliveredForRecipient(db, "b@r", Date.now());
    expect(pending).toHaveLength(1);
    const firstPending = pending[0];
    if (!firstPending) {
      throw new Error("expected a pending message for b@r");
    }
    expect(firstPending.status).toBe("sent");

    // B reads inbox: sent -> delivered -> read.
    const inboxResult = await clientB.callTool({ name: "inbox", arguments: {} });
    expect(inboxResult.isError).not.toBe(true);
    const { messages } = InboxResult.parse(inboxResult.structuredContent);
    expect(messages).toHaveLength(1);

    const stillPending = messagesRepo.listUndeliveredForRecipient(db, "b@r", Date.now());
    expect(stillPending).toHaveLength(0);

    const all = messagesRepo.listThreadMessages(db, threadId);
    const first = all[0];
    if (!first) {
      throw new Error("expected a message in the thread");
    }
    expect(first.status).toBe("read");

    // B replies: the original moves to replied (PLAN 4.3).
    await talk(clientB, "a@r", "yes, I can take that", "k2", messageId, threadId);

    const replied = messagesRepo.findMessage(db, messageId);
    if (!replied) {
      throw new Error("expected the original message to exist");
    }
    expect(replied.status).toBe("replied");

    db.close();
  });

  it("an agreement is offered by A and accepted by B", async () => {
    const db = openMemoryDb();
    applyRetention(db, retentionCutoff(Date.now()));
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");

    const { threadId } = await talk(clientA, "b@r", "can you take this?", "k2");

    // A offers an agreement.
    const offerResult = await clientA.callTool({
      name: "agree",
      arguments: { action: "offer", thread_id: threadId, text: "a@r implements the migration" },
    });
    expect(offerResult.isError).not.toBe(true);
    AgreementResult.parse(offerResult.structuredContent);

    const agreements = agreementsRepo.listAgreementsByRepo(db, REPO_ROOT);
    expect(agreements).toHaveLength(1);
    const offered = agreements[0];
    if (!offered) {
      throw new Error("expected an offered agreement");
    }
    expect(offered.status).toBe("offered");
    expect(offered.offered_by).toBe("a@r");
    expect(offered.offered_to).toBe("b@r");
    const agreementId = offered.id;

    // B accepts.
    const acceptResult = await clientB.callTool({
      name: "agree",
      arguments: { action: "accept", agreement_id: agreementId },
    });
    expect(acceptResult.isError).not.toBe(true);
    AgreementResult.parse(acceptResult.structuredContent);

    const updated = agreementsRepo.getAgreement(db, agreementId);
    expect(updated.status).toBe("accepted");
    expect(updated.answered_by).toBe("b@r");

    db.close();
  });

  it("refuses a forbidden answer through MCP: a third agent cannot accept an offer made to another", async () => {
    const db = openMemoryDb();
    applyRetention(db, retentionCutoff(Date.now()));
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");
    const clientC = await startServer(db, "c@r");

    const { threadId } = await talk(clientA, "b@r", "can you take this?", "k3");

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
    expect(offered.offered_to).toBe("b@r");
    const agreementId = offered.id;

    // c@r was not the recipient: the accept is refused and the row stays offered.
    const thirdResult = await clientC.callTool({
      name: "agree",
      arguments: { action: "accept", agreement_id: agreementId },
    });
    expect(thirdResult.isError).toBe(true);
    const { error } = RefusalResult.parse(thirdResult.structuredContent);
    expect(error).toBe("not_answerable");

    const untouched = agreementsRepo.getAgreement(db, agreementId);
    expect(untouched.status).toBe("offered");
    expect(untouched.answered_by).toBeNull();

    // b@r, the actual recipient, can still accept.
    const acceptResult = await clientB.callTool({
      name: "agree",
      arguments: { action: "accept", agreement_id: agreementId },
    });
    expect(acceptResult.isError).not.toBe(true);
    expect(agreementsRepo.getAgreement(db, agreementId).status).toBe("accepted");

    db.close();
  });

  it("a reply with only reply_to (no thread_id) joins the original's thread", async () => {
    // Live test 2026-11-07: woken agents only know the message id from the
    // monitor line, and both replies failed with reply_to_unknown.
    const db = openMemoryDb();
    const clientA = await startServer(db, "a@r");
    const clientB = await startServer(db, "b@r");
    const first = await talk(clientA, "b@r", "can you hear me?", "rt1");
    // B sees it first (in real use the monitor delivers it), then replies.
    await clientB.callTool({ name: "inbox", arguments: {} });
    const reply = await talk(clientB, "a@r", "yes, loud and clear", "rt2", first.messageId);
    expect(reply.threadId).toBe(first.threadId);
    expect(messagesRepo.findMessage(db, first.messageId)?.status).toBe("replied");
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
