import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsRepo, openDb, openMemoryDb } from "../../src/store/index.js";
import {
  runHookPostTool,
  runHookSessionStart,
  runHookUserPrompt,
} from "../../src/cli/commands/hook-events.js";
import { runInboxDrain } from "../../src/cli/commands/inbox.js";
import { serve } from "../../src/mcp/server.js";

/**
 * Regressions from the M4 live test (2026-11-07): identity must follow the
 * Claude session, never the repo root's name or a folder the session cd'd into.
 */
const REPO = "/repo";

function deps(db: ReturnType<typeof openMemoryDb>, now: number) {
  return { db, repoRoot: REPO, status: (): void => undefined, now };
}

describe("session-bound identity", () => {
  it("a session that cd's into another folder keeps its own agent", () => {
    const db = openMemoryDb();
    runHookSessionStart(deps(db, 1_000), { session_id: "S-api", cwd: "/repo/api", source: "startup" });
    runHookUserPrompt(deps(db, 2_000), { session_id: "S-api", cwd: "/repo/web", prompt: "hi" });
    runHookPostTool(deps(db, 3_000), { session_id: "S-api", cwd: "/repo/web", tool_name: "Bash" });
    expect(agentsRepo.findAgent(db, "claude@web")).toBeUndefined();
    const api = agentsRepo.getAgent(db, "claude@api");
    expect(api.native_session).toBe("S-api");
    expect(api.last_heartbeat).toBe(3_000);
  });

  it("a monitor poll counts as a heartbeat without stealing the session", () => {
    const db = openMemoryDb();
    runHookSessionStart(deps(db, 1_000), { session_id: "S-web", cwd: "/repo/web", source: "startup" });
    runInboxDrain({ db, repoRoot: REPO, write: (): void => undefined, now: 9_000 }, "claude@web", "monitor", "monitor-42");
    const web = agentsRepo.getAgent(db, "claude@web");
    expect(web.last_heartbeat).toBe(9_000);
    expect(web.native_session).toBe("S-web");
  });
});

describe("serve() identity", () => {
  async function serveAt(
    options: { cwd: string; sessionId?: string; seed?: (path: string) => void },
  ): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "parley-ident-"));
    const dbPath = join(dir, "hub.db");
    try {
      options.seed?.(dbPath);
      const handle = await serve({
        repoRoot: REPO,
        cwd: options.cwd,
        sessionId: options.sessionId,
        dbPath,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      });
      handle.close();
      const db = openDb({ path: dbPath });
      const ids = agentsRepo.listAgentsByRepo(db, REPO).map((a) => a.id);
      db.close();
      return ids.join(",");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("names the agent after the session's folder, not the repo root", async () => {
    process.env["PARLEY_HARNESS"] = "claude";
    try {
      expect(await serveAt({ cwd: "/repo/api", sessionId: "S1" })).toBe("claude@api");
    } finally {
      delete process.env["PARLEY_HARNESS"];
    }
  });

  it("reuses the agent its session registered at SessionStart", async () => {
    const ids = await serveAt({
      cwd: "/repo/web",
      sessionId: "S-api",
      seed: (path) => {
        const db = openDb({ path });
        runHookSessionStart(
          { db, repoRoot: REPO, status: (): void => undefined, now: 1 },
          { session_id: "S-api", cwd: "/repo/api", source: "startup" },
        );
        db.close();
      },
    });
    expect(ids).toBe("claude@api");
  });
});

describe("session link survives the monitor's register", () => {
  it("register without a session keeps SessionStart's link, so a later cd does not take over", async () => {
    const { runInboxRegister } = await import("../../src/cli/commands/inbox.js");
    const db = openMemoryDb();
    runHookSessionStart(deps(db, 1_000), { session_id: "S-api", cwd: "/repo/api", source: "startup" });
    runInboxRegister({ db, repoRoot: REPO, write: (): void => undefined, now: 1_500 }, "claude@api", null);
    runHookUserPrompt(deps(db, 2_000), { session_id: "S-api", cwd: "/repo/web", prompt: "hi" });
    expect(agentsRepo.getAgent(db, "claude@api").native_session).toBe("S-api");
    expect(agentsRepo.findAgent(db, "claude@web")).toBeUndefined();
  });
});
