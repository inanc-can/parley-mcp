import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RpcError,
  controlSocketPath,
  decodeFrames,
  encodeClientFrame,
  openControlSocket,
} from "../../src/adapters/codex/control-socket.js";

/** An unmasked server text frame. */
function serverFrame(opcode: number, text: string): Buffer {
  const payload = Buffer.from(text);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

const responseSchemaFree = (text: string): { id?: number; method: string } => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("method" in value) || typeof value.method !== "string") {
    throw new Error("bad request");
  }
  return { method: value.method, ...("id" in value && typeof value.id === "number" ? { id: value.id } : {}) };
};

let dir = "";
let server: Server | undefined;
const seen: string[] = [];

/** A tiny stand-in for the Codex daemon: upgrades, then answers JSON-RPC by method. */
function startFakeDaemon(path: string, mode: "ok" | "refuse-upgrade"): Promise<void> {
  server = createServer((socket: Socket) => {
    let buf: Buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on("error", () => undefined); // the client may drop the connection on close
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }
        const head = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 4);
        if (mode === "refuse-upgrade") {
          socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
          return;
        }
        const key = /Sec-WebSocket-Key: (.+)\r?$/m.exec(head)?.[1]?.trim() ?? "";
        const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        // Unsolicited traffic the client must tolerate: a ping and a notification.
        socket.write(Buffer.from([0x89, 0x00]));
        socket.write(serverFrame(0x1, JSON.stringify({ method: "configWarning", params: {} })));
        upgraded = true;
      }
      const { frames, rest } = decodeFrames(buf);
      buf = rest;
      for (const frame of frames) {
        if (frame.opcode !== 0x1) {
          continue;
        }
        const req = responseSchemaFree(frame.payload.toString());
        seen.push(req.method);
        if (req.id === undefined) {
          continue;
        }
        const reply =
          req.method === "initialize"
            ? { id: req.id, result: { userAgent: "codex-tui/0.154.0 (test) linux" } }
            : req.method === "big"
              ? { id: req.id, result: { blob: "x".repeat(70_000) } }
              : { id: req.id, error: { code: -32600, message: "thread not found" } };
        socket.write(serverFrame(0x1, JSON.stringify(reply)));
      }
    });
  });
  return new Promise((resolve) => server?.listen(path, resolve));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parley-sock-"));
  seen.length = 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("WebSocket frames", () => {
  it("round-trips masked client frames of every length class", () => {
    for (const size of [5, 300, 70_000]) {
      const payload = Buffer.alloc(size, 7);
      const { frames, rest } = decodeFrames(encodeClientFrame(0x1, payload));
      expect(rest.length).toBe(0);
      expect(frames[0]?.opcode).toBe(0x1);
      expect(frames[0]?.payload.equals(payload)).toBe(true);
    }
  });

  it("keeps a partial frame for the next chunk", () => {
    const whole = serverFrame(0x1, "hello");
    const first = decodeFrames(whole.subarray(0, 3));
    expect(first.frames).toHaveLength(0);
    const second = decodeFrames(Buffer.concat([first.rest, whole.subarray(3)]));
    expect(second.frames[0]?.payload.toString()).toBe("hello");
  });
});

describe("controlSocketPath", () => {
  it("honours CODEX_HOME, else ~/.codex", () => {
    expect(controlSocketPath({ CODEX_HOME: "/x" }, "/home/u")).toBe("/x/app-server-control/app-server-control.sock");
    expect(controlSocketPath({}, "/home/u")).toBe("/home/u/.codex/app-server-control/app-server-control.sock");
  });
});

describe("openControlSocket", () => {
  it("upgrades, sends requests and matches responses by id, tolerating pings and notifications", async () => {
    const path = join(dir, "s.sock");
    await startFakeDaemon(path, "ok");
    const conn = await openControlSocket(path, 2000);
    const init = await conn.request("initialize", { clientInfo: { name: "t", version: "0" } });
    expect(init).toEqual({ userAgent: "codex-tui/0.154.0 (test) linux" });
    conn.notify("initialized");
    const big = await conn.request("big", {});
    expect(JSON.stringify(big).length).toBeGreaterThan(70_000);
    await expect(conn.request("thread/read", { threadId: "t" })).rejects.toBeInstanceOf(RpcError);
    conn.close();
    expect(seen).toEqual(["initialize", "initialized", "big", "thread/read"]);
  });

  it("rejects when the socket does not exist", async () => {
    await expect(openControlSocket(join(dir, "missing.sock"), 500)).rejects.toThrow();
  });

  it("rejects when the server refuses the upgrade", async () => {
    const path = join(dir, "s.sock");
    await startFakeDaemon(path, "refuse-upgrade");
    await expect(openControlSocket(path, 2000)).rejects.toThrow(/refused the WebSocket upgrade/);
  });
});
