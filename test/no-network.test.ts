import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { openMemoryDb, settingsRepo } from "../src/store/index.js";

/**
 * AGENTS.md hard limit: no network calls from the tool, except the viewer on
 * 127.0.0.1 (and no telemetry until the human decides, PLAN M11). This scans
 * the source for network APIs and allows only the known local uses.
 */

const ALLOWED: Record<string, string> = {
  // The viewer: node:http server bound to 127.0.0.1 (PLAN section 8).
  "src/viewer/server.ts": "node:http",
  // The viewer page fetches its own local server (same origin).
  "src/viewer/static/app.ts": "fetch",
  // The Codex app-server control socket: a local Unix socket, not the network.
  "src/adapters/codex/control-socket.ts": "node:net",
};

const NETWORK = [
  /from\s+"node:(https?|net|tls|dgram|http2)"/,
  /from\s+"(https?|net|tls|dgram|http2)"/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\s*\(/,
  /\bXMLHttpRequest\b/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : files(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("no network calls (AGENTS.md, PLAN M11)", () => {
  it("only the known local uses touch network APIs", () => {
    const offenders: string[] = [];
    for (const file of files(join(process.cwd(), "src"))) {
      const rel = relative(process.cwd(), file);
      const text = readFileSync(file, "utf8");
      for (const pattern of NETWORK) {
        if (pattern.test(text) && ALLOWED[rel] === undefined) {
          offenders.push(`${rel}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the viewer binds to 127.0.0.1 only and the Codex socket is a local path", () => {
    expect(readFileSync(join(process.cwd(), "src/viewer/server.ts"), "utf8")).toContain('const HOST = "127.0.0.1"');
    expect(readFileSync(join(process.cwd(), "src/adapters/codex/control-socket.ts"), "utf8")).toContain("connect(path)");
  });

  it("telemetry consent defaults to off and is only a stored flag", () => {
    const db = openMemoryDb();
    expect(settingsRepo.getTelemetryOptIn(db)).toBe(false);
    settingsRepo.setTelemetryOptIn(db, true);
    expect(settingsRepo.getTelemetryOptIn(db)).toBe(true);
    settingsRepo.setTelemetryOptIn(db, false);
    expect(settingsRepo.getTelemetryOptIn(db)).toBe(false);
    db.close();
  });
});
