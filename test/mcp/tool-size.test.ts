import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { openMemoryDb } from "../../src/store/index.js";
import { createServer } from "../../src/mcp/server.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { estimateTokens } from "../../src/core/cost.js";

/**
 * PLAN section 5: "the three tool definitions together should be under 1,500
 * tokens." We measure the serialized size of the three tool definitions (name,
 * description, input schema) as seen over the wire via listTools, estimate
 * tokens at chars/4 (the project's own estimate), print the measurement, and
 * fail above 1,500.
 */
async function toolDefinitionsSize(): Promise<number> {
  const db = openMemoryDb();
  try {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    registerCaller(db, "a@r", "/repo", null, Date.now());
    const server = createServer({
      db,
      agentId: "a@r",
      repoRoot: "/repo",
      nativeSession: null,
      rulesTextSent: false,
    });
    await server.connect(serverTransport);
    const client = new Client({ name: "size-client", version: "0.0.0" });
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const serialized = JSON.stringify(tools);
    return estimateTokens(serialized);
  } finally {
    db.close();
  }
}

describe("tool definition token size", () => {
  it("measures and prints the token size of the three tool definitions (must be under 1,500)", async () => {
    const size = await toolDefinitionsSize();
    console.log(`Three tool definitions: ~${String(size)} tokens (chars/4 estimate)`);
    expect(size).toBeLessThan(1500);
  });
});
