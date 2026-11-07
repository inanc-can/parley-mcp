import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import type { MessageExtraInfo } from "@modelcontextprotocol/sdk/types";
import { openDb, messagesRepo, threadsRepo } from "../../src/store/index.js";
import { serve } from "../../src/mcp/server.js";

const REPO_ROOT = "/repo";

const TalkResultSchema = z.object({
  message_id: z.string(),
  thread_id: z.string(),
  status: z.string(),
  outlook: z.string(),
});

const JsonRpcEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().optional(),
  id: z.string().or(z.number()).optional().nullable(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

function parseJsonLine(line: string): unknown {
  const parsed: unknown = JSON.parse(line);
  return JsonRpcEnvelopeSchema.safeParse(parsed).success ? parsed : null;
}

/**
 * A minimal MCP Transport bridging two Node streams: the client writes JSON-RPC
 * requests to `toServer` (which `serve()` reads as stdin) and reads responses
 * from `fromServer` (which `serve()` writes to as stdout).
 */
class StreamPairTransport {
  private buffer = "";
  onmessage?: (message: unknown, extra?: MessageExtraInfo) => void;
  onclose?: () => void;
  onerror?: ((error: Error) => void) | undefined;
  sessionId?: string | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;

  constructor(
    private readonly toServer: PassThrough,
    private readonly fromServer: PassThrough,
  ) {
    fromServer.on("data", (chunk: unknown) => {
      this.buffer += String(chunk);
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        const message = parseJsonLine(line);
        if (message !== null) {
          this.onmessage?.(message);
        }
        index = this.buffer.indexOf("\n");
      }
    });
    fromServer.on("error", (error: Error) => {
      this.onerror?.(error);
    });
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(message: unknown): Promise<void> {
    const data = JSON.stringify(message) + "\n";
    return new Promise<void>((resolve, reject) => {
      if (this.toServer.write(data)) {
        resolve();
      } else {
        this.toServer.once("drain", () => {
          resolve();
        });
        this.toServer.once("error", (error: Error) => {
          reject(error);
        });
      }
    });
  }

  close(): Promise<void> {
    this.toServer.end();
    this.fromServer.end();
    this.onclose?.();
    return Promise.resolve();
  }
}

describe("serve() over a real stdio stream pair", () => {
  it("keeps the hub db open across a real talk tool call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parley-serve-"));
    const dbPath = join(dir, "hub.db");
    try {
      const toServer = new PassThrough();
      const fromServer = new PassThrough();

      // serve() returns once the stdio transport is wired up; the db stays
      // open until the transport closes, so a real tool call can use it.
      await serve({
        agentIdEnv: "a@r",
        repoRoot: REPO_ROOT,
        dbPath,
        stdin: toServer,
        stdout: fromServer,
      });

      const transport = new StreamPairTransport(toServer, fromServer);
      const client = new Client({ name: "serve-test-client", version: "0.0.0" });
      await client.connect(transport);

      // A real tool call over stdio. If the db had been closed, this would
      // fail with a "closed database" error from better-sqlite3.
      const result = await client.callTool({
        name: "talk",
        arguments: {
          to: "b@r",
          text: "hello over stdio",
          idempotency_key: "serve-1",
        },
      });

      expect(result.isError).not.toBe(true);
      const content = TalkResultSchema.parse(result.structuredContent);
      expect(content.status).toBe("sent");
      expect(content.message_id).toBeTypeOf("string");
      expect(content.thread_id).toBeTypeOf("string");
      expect(content.outlook).toBeTypeOf("string");

      // The write committed to the still-open hub db: open a second read
      // connection to the same file and confirm the message is stored.
      const checkDb = openDb({ path: dbPath });
      try {
        const threadRows = threadsRepo.listThreadsByRepo(checkDb, REPO_ROOT);
        expect(threadRows).toHaveLength(1);
        const thread = threadRows[0];
        if (!thread) {
          throw new Error("expected a thread to be stored");
        }
        const messages = messagesRepo.listThreadMessages(checkDb, thread.id);
        const first = messages[0];
        if (!first) {
          throw new Error("expected a stored message");
        }
        expect(first.body).toBe("hello over stdio");
        expect(first.status).toBe("sent");
      } finally {
        checkDb.close();
      }

      await transport.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
