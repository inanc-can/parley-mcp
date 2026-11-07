import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * A minimal JSON-RPC client for the Codex app-server daemon's control socket
 * (`$CODEX_HOME/app-server-control/app-server-control.sock`).
 *
 * Verified live against codex 0.154.0 (docs/harness-notes.md, M5 wake section):
 * the socket speaks WebSocket (an HTTP upgrade, then text frames carrying one
 * JSON-RPC message each), not newline-delimited JSON. A plain `codex` TUI
 * started while the daemon runs attaches to the daemon, so a second client on
 * this socket sees the same threads and can `turn/start` on them.
 *
 * Only what the wake needs is implemented: client text frames (masked, as RFC
 * 6455 requires), unfragmented server text frames, ping/pong and close. No new
 * dependency: PLAN's allowed list has no WebSocket package.
 */

/** Where the daemon listens, honouring CODEX_HOME like Codex itself. */
export function controlSocketPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const codexHome = env["CODEX_HOME"];
  const base = codexHome !== undefined && codexHome.length > 0 ? codexHome : join(home, ".codex");
  return join(base, "app-server-control", "app-server-control.sock");
}

export interface RpcConnection {
  /** Send a request and resolve with its `result`; rejects on an RPC error or timeout. */
  request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** Send a notification (no response). */
  notify(method: string, params?: Record<string, unknown>): void;
  close(): void;
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = "RpcError";
  }
}

const responseSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number().optional(), message: z.string() }).optional(),
});

const DEFAULT_TIMEOUT_MS = 5000;

const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Encode one masked client frame (RFC 6455 section 5.2). */
export function encodeClientFrame(opcode: number, payload: Buffer, mask: Buffer = randomBytes(4)): Buffer {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  }
  return Buffer.concat([header, mask, masked]);
}

export interface Frame {
  opcode: number;
  payload: Buffer;
}

/**
 * Decode as many complete server frames as `buffer` holds. Returns them and
 * the unconsumed rest. Server frames are unmasked; a masked one is still read.
 */
export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let buf = buffer;
  for (;;) {
    const first = buf[0];
    const second = buf[1];
    if (first === undefined || second === undefined) {
      break;
    }
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) {
        break;
      }
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) {
        break;
      }
      length = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = (second & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    if (buf.length < offset + maskLength + length) {
      break;
    }
    const mask = buf.subarray(offset, offset + maskLength);
    const payload = Buffer.from(buf.subarray(offset + maskLength, offset + maskLength + length));
    if (masked) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
    }
    frames.push({ opcode: first & 0x0f, payload });
    buf = buf.subarray(offset + maskLength + length);
  }
  return { frames, rest: buf };
}

/**
 * Connect to the control socket, upgrade to WebSocket and return an RPC
 * connection. Rejects (never throws synchronously) when the socket is missing,
 * refuses, or does not upgrade within `timeoutMs`.
 */
export function openControlSocket(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<RpcConnection> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let buffer: Buffer = Buffer.alloc(0);
    let upgraded = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no WebSocket upgrade from ${path} within ${String(timeoutMs)} ms`));
    }, timeoutMs);

    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>();
    let nextId = 0;
    const failAll = (error: Error): void => {
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
    };
    const sendText = (value: unknown): void => {
      socket.write(encodeClientFrame(OP_TEXT, Buffer.from(JSON.stringify(value))));
    };

    const onMessage = (text: string): void => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return; // not JSON: ignore rather than crash the wake
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success || typeof parsed.data.id !== "number") {
        return; // a notification or a server-initiated request: the wake ignores both
      }
      const entry = pending.get(parsed.data.id);
      if (entry === undefined) {
        return;
      }
      pending.delete(parsed.data.id);
      if (parsed.data.error !== undefined) {
        entry.reject(new RpcError(entry.method, parsed.data.error.code ?? null, parsed.data.error.message));
      } else {
        entry.resolve(parsed.data.result);
      }
    };

    const connection: RpcConnection = {
      request(method, params, requestTimeoutMs = DEFAULT_TIMEOUT_MS) {
        nextId += 1;
        const id = nextId;
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            pending.delete(id);
            rej(new RpcError(method, null, `no response within ${String(requestTimeoutMs)} ms`));
          }, requestTimeoutMs);
          pending.set(id, {
            method,
            resolve: (v) => {
              clearTimeout(t);
              res(v);
            },
            reject: (e) => {
              clearTimeout(t);
              rej(e);
            },
          });
          sendText({ jsonrpc: "2.0", id, method, params });
        });
      },
      notify(method, params) {
        sendText(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
      },
      close() {
        socket.end(encodeClientFrame(OP_CLOSE, Buffer.alloc(0)));
        socket.destroy();
      },
    };

    socket.on("connect", () => {
      socket.write(
        "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }
        const head = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 4);
        clearTimeout(timer);
        if (!head.startsWith("HTTP/1.1 101")) {
          socket.destroy();
          reject(new Error(`control socket refused the WebSocket upgrade: ${head.split("\r\n")[0] ?? ""}`));
          return;
        }
        upgraded = true;
        resolve(connection);
      }
      handleFrames(socket, buffer, onMessage, (rest) => {
        buffer = rest;
      });
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      failAll(error);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      failAll(new Error("control socket closed"));
    });
  });
}

function handleFrames(socket: Socket, buffer: Buffer, onMessage: (text: string) => void, keep: (rest: Buffer) => void): void {
  const { frames, rest } = decodeFrames(buffer);
  keep(rest);
  for (const frame of frames) {
    if (frame.opcode === OP_TEXT) {
      onMessage(frame.payload.toString("utf8"));
    } else if (frame.opcode === OP_PING) {
      socket.write(encodeClientFrame(OP_PONG, frame.payload));
    } else if (frame.opcode === OP_CLOSE) {
      socket.destroy();
    }
  }
}
