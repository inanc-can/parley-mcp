import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "../store/index.js";
import { buildState, buildThreadView, changeSignature } from "./api-read.js";
import {
  closeThread,
  pauseThread,
  postAsHuman,
  resumeThread,
  setStopAll,
  vetoAgreement,
  type ActionResult,
  type WriteDeps,
} from "./api-write.js";

/**
 * The viewer's HTTP server (PLAN section 8): `node:http` bound to 127.0.0.1
 * only, a random token required on every request (query `?token=` or header
 * `x-parley-token`), a Host check against DNS rebinding, JSON endpoints for
 * the page, and Server-Sent Events that tell the page when to refetch.
 *
 * There is no daemon (PLAN section 3): agents write the SQLite file from other
 * processes, so one poller compares a change signature every `pollMs` and
 * broadcasts `change` to every open event stream.
 */

export interface ViewerOptions {
  db: Db;
  repoRoot: string;
  /** 0 (default) picks a free port. */
  port?: number;
  token?: string;
  pollMs?: number;
  /** Where index.html, styles.css and the bundled app.js live. */
  staticDir?: string;
  now?: () => number;
  wakeRecipient?: (agentId: string, harness: string) => boolean;
  /** Export writer (md or jsonl lines), injected so the viewer does not depend on the CLI. */
  exportLines?: (format: "md" | "jsonl") => string[];
}

export interface ViewerHandle {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_POLL_MS = 1000;
const KEEPALIVE_MS = 15_000;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
};
const PUBLIC_ASSETS = new Set(["/app.js", "/styles.css"]);
const CONTENT_TYPES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
};

const postSchema = z.object({ text: z.string().max(20_000), idempotency_key: z.string().min(1).max(200).optional() });
const stopAllSchema = z.object({ on: z.boolean() });

export function defaultStaticDir(): string {
  return fileURLToPath(new URL("./static/", import.meta.url));
}

export function startViewer(options: ViewerOptions): Promise<ViewerHandle> {
  const token = options.token ?? randomBytes(24).toString("hex");
  const staticDir = options.staticDir ?? defaultStaticDir();
  const now = options.now ?? Date.now;
  const streams = new Set<ServerResponse>();
  let boundPort = 0;

  const writeDeps = (): WriteDeps => {
    const deps: WriteDeps = { db: options.db, repoRoot: options.repoRoot, now: now() };
    if (options.wakeRecipient !== undefined) {
      deps.wakeRecipient = options.wakeRecipient;
    }
    return deps;
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { error: "internal", detail: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (!hostAllowed(req.headers.host, boundPort)) {
      sendJson(res, 403, { error: "bad_host" });
      return;
    }
    const method = req.method ?? "GET";
    // The page's own code and styles hold no data, and the browser fetches them
    // without the token; everything else (the page itself and all data) needs it.
    if (method === "GET" && PUBLIC_ASSETS.has(url.pathname)) {
      serveStatic(res, staticDir, url.pathname.slice(1));
      return;
    }
    const supplied = url.searchParams.get("token") ?? headerValue(req.headers["x-parley-token"]);
    if (!tokenMatches(supplied, token)) {
      sendJson(res, 403, { error: "bad_token" });
      return;
    }
    const staticName = STATIC_FILES[url.pathname];
    if (method === "GET" && staticName !== undefined) {
      serveStatic(res, staticDir, staticName);
      return;
    }
    if (method === "GET" && url.pathname === "/api/events") {
      openStream(res, streams);
      return;
    }
    if (method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, buildState(options.db, options.repoRoot, now()));
      return;
    }
    if (method === "GET" && url.pathname === "/api/export") {
      serveExport(res, url.searchParams.get("format"), options.exportLines);
      return;
    }
    const threadMatch = /^\/api\/threads\/([^/]+)(?:\/(messages|pause|resume|close))?$/.exec(url.pathname);
    if (threadMatch !== null) {
      const threadId = decodeURIComponent(threadMatch[1] ?? "");
      const action = threadMatch[2];
      if (method === "GET" && action === undefined) {
        const view = buildThreadView(options.db, options.repoRoot, threadId);
        if (view === null) {
          sendJson(res, 404, { error: "thread_not_found" });
        } else {
          sendJson(res, 200, view);
        }
        return;
      }
      if (method === "POST" && action === "messages") {
        const body = postSchema.safeParse(await readJson(req));
        if (!body.success) {
          sendJson(res, 400, { error: "bad_request" });
          return;
        }
        const key = body.data.idempotency_key ?? randomBytes(12).toString("hex");
        sendResult(res, postAsHuman(writeDeps(), threadId, body.data.text, key));
        return;
      }
      if (method === "POST" && action !== undefined) {
        const run = action === "pause" ? pauseThread : action === "resume" ? resumeThread : closeThread;
        sendResult(res, run(writeDeps(), threadId));
        return;
      }
    }
    const vetoMatch = /^\/api\/agreements\/([^/]+)\/veto$/.exec(url.pathname);
    if (method === "POST" && vetoMatch !== null) {
      sendResult(res, vetoAgreement(writeDeps(), decodeURIComponent(vetoMatch[1] ?? "")));
      return;
    }
    if (method === "POST" && url.pathname === "/api/stop-all") {
      const body = stopAllSchema.safeParse(await readJson(req));
      if (!body.success) {
        sendJson(res, 400, { error: "bad_request" });
        return;
      }
      sendResult(res, setStopAll(writeDeps(), body.data.on));
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  }

  // One poller for all streams: refetch hints only when something changed.
  let lastSignature = changeSignature(options.db, options.repoRoot, now());
  const poller = setInterval(() => {
    if (streams.size === 0) {
      return;
    }
    const signature = changeSignature(options.db, options.repoRoot, now());
    if (signature !== lastSignature) {
      lastSignature = signature;
      broadcast(streams, "change", { at: now() });
    }
  }, options.pollMs ?? DEFAULT_POLL_MS);
  const keepalive = setInterval(() => {
    for (const stream of streams) {
      stream.write(": keepalive\n\n");
    }
  }, KEEPALIVE_MS);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, HOST, () => {
      const address = server.address();
      boundPort = typeof address === "object" && address !== null ? (address satisfies AddressInfo).port : 0;
      resolve({
        url: `http://${HOST}:${String(boundPort)}/?token=${token}`,
        port: boundPort,
        token,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(poller);
            clearInterval(keepalive);
            for (const stream of streams) {
              stream.end();
            }
            streams.clear();
            server.close(() => {
              done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}

function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `${HOST}:${String(port)}` || host === `localhost:${String(port)}`;
}

function headerValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function tokenMatches(supplied: string | null, token: string): boolean {
  if (supplied === null) {
    return false;
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendResult(res: ServerResponse, result: ActionResult<unknown>): void {
  if (result.ok) {
    sendJson(res, 200, { ok: true, value: result.value ?? null });
  } else {
    sendJson(res, result.status, { error: result.code, detail: result.detail });
  }
}

function serveStatic(res: ServerResponse, dir: string, name: string): void {
  const path = join(dir, name);
  if (!existsSync(path)) {
    const hint = name === "app.js" ? " Run `pnpm build` to bundle the viewer." : "";
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end(`${name} not found.${hint}`);
    return;
  }
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": CONTENT_TYPES[name] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

function serveExport(
  res: ServerResponse,
  format: string | null,
  exportLines: ViewerOptions["exportLines"],
): void {
  if ((format !== "md" && format !== "jsonl") || exportLines === undefined) {
    sendJson(res, 400, { error: "bad_format" });
    return;
  }
  const ext = format === "md" ? "md" : "jsonl";
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "application/x-ndjson; charset=utf-8",
    "Content-Disposition": `attachment; filename="parley-export.${ext}"`,
  });
  res.end(`${exportLines(format).join("\n")}\n`);
}

function openStream(res: ServerResponse, streams: Set<ServerResponse>): void {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
  });
  res.write("event: ready\ndata: {}\n\n");
  streams.add(res);
  res.on("close", () => {
    streams.delete(res);
  });
}

function broadcast(streams: Set<ServerResponse>, event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const stream of streams) {
    stream.write(frame);
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => {
      resolve(null);
    });
  });
}
