import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { harnessInstructions } from "../../src/cli/commands/serve.js";
import { runInboxWatchOnce } from "../../src/cli/commands/inbox.js";
import type { PayloadHookHost } from "../../src/cli/cursor-hook-commands.js";
import { registerCursorHookCommands } from "../../src/cli/cursor-hook-commands.js";
import { registerGrokHookCommands } from "../../src/cli/grok-hook-commands.js";
import { registerHookCommands } from "../../src/cli/hook-commands.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { createServer } from "../../src/mcp/server.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { handleTalk } from "../../src/mcp/tools/talk.js";
import { agentsRepo, claimsRepo, editsRepo, messagesRepo, openMemoryDb, type Db } from "../../src/store/index.js";

const FIXTURES = join(process.cwd(), "src", "adapters", "grok", "fixtures");
const SESSION = "6b1f0c2e-aaaa-bbbb-cccc-000011112222";
const REPO = "/repo";
const LAUNCHER = "/home/u/.mcp-parley/bin/mcp-parley";

function fixture(name: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))), ...override };
}

let db: Db;

function host(payload: unknown, out: string[], env: NodeJS.ProcessEnv = {}): PayloadHookHost {
  return {
    withDbAt: (dir, run) => {
      expect(dir).toBe("/repo/web"); // the session's cwd, from the payload
      return run(db, REPO);
    },
    status: () => () => undefined,
    readStdinJson: () => Promise.resolve(payload),
    write: (line) => out.push(line),
    env,
    launcher: LAUNCHER,
    wakeCodex: () => false,
    notify: () => undefined,
  };
}

async function grok(command: string, payload: unknown): Promise<string[]> {
  const out: string[] = [];
  const program = new Command();
  registerGrokHookCommands(program.command("hook"), host(payload, out));
  await program.parseAsync(["hook", command], { from: "user" });
  return out;
}

async function sendToGrok(text: string, key: string): Promise<string> {
  registerCaller(db, "claude@api", REPO, "claude-1", Date.now());
  const ctx: ToolContext = { db, agentId: "claude@api", repoRoot: REPO, nativeSession: null, rulesTextSent: false };
  await handleTalk(ctx, { to: "grok@web", text, idempotency_key: key });
  const pending = messagesRepo.listUndeliveredForRecipient(db, "grok@web", Date.now());
  return pending[pending.length - 1]?.id ?? "";
}

const reminderSchema = z.object({ decision: z.literal("block"), reason: z.string() });

beforeEach(() => {
  db = openMemoryDb();
});

describe("grok session hooks", () => {
  it("registers grok@<cwd folder> for the session and prints nothing (Grok ignores passive stdout)", async () => {
    expect(await grok("grok-session-start", fixture("session-start.json"))).toEqual([]);
    expect(agentsRepo.findAgentBySession(db, SESSION)?.id).toBe("grok@web");
  });

  it("marks a message read when its id is in the prompt", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    const id = await sendToGrok("hello", "g1");
    runInboxWatchOnce({ db, repoRoot: REPO, write: () => undefined }, "grok@web", "monitor", SESSION);
    await grok("grok-user-prompt", fixture("user-prompt.json", { prompt: `about (id ${id})` }));
    expect(messagesRepo.getMessage(db, id).status).toBe("read");
  });

  it("records edits from Grok's tool names and `path` inputs", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    registerCaller(db, "claude@api", REPO, null, Date.now());
    claimsRepo.insertClaim(db, { id: "c1", repoRoot: REPO, agentId: "claude@api", pathGlob: "/repo/web/src/auth/**", expiresAt: Date.now() + 60_000 });
    await grok("grok-post-tool", fixture("post-tool-edit.json"));
    // Stored repo-relative, so every harness's form of the path meets.
    expect(editsRepo.listRecentEditsForPath(db, REPO, "web/src/auth/login.ts", 0).map((e) => e.agent_id)).toEqual(["grok@web"]);
  });

  it("requeues unread deliveries when the session ends", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    const id = await sendToGrok("hello", "g2");
    runInboxWatchOnce({ db, repoRoot: REPO, write: () => undefined }, "grok@web", "monitor", SESSION);
    await grok("grok-session-end", fixture("session-end.json"));
    expect(messagesRepo.getMessage(db, id).status).toBe("sent");
  });
});

describe("the Stop reminder (M9 check)", () => {
  it("fires once per session when no monitor runs, with the exact command", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    const first = await grok("grok-stop", fixture("stop.json"));
    expect(first).toHaveLength(1);
    const reminder = reminderSchema.parse(JSON.parse(first[0] ?? ""));
    expect(reminder.reason).toContain(`"${LAUNCHER}" inbox watch --agent grok@web --provider grok`);
    expect(await grok("grok-stop", fixture("stop.json"))).toEqual([]);
    // A new session gets its own single reminder.
    expect(await grok("grok-stop", fixture("stop.json", { sessionId: "another-session" }))).toHaveLength(1);
  });

  it("stays quiet when the monitor is listed or our watch is running", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    expect(await grok("grok-stop", fixture("stop-with-monitor.json"))).toEqual([]);
    runInboxWatchOnce({ db, repoRoot: REPO, write: () => undefined }, "grok@web", "monitor", null);
    expect(await grok("grok-stop", fixture("stop.json"))).toEqual([]);
  });

  it("stays quiet for subagents, a re-entered stop, and turns that did not end normally", async () => {
    await grok("grok-session-start", fixture("session-start.json"));
    expect(await grok("grok-stop", fixture("stop-subagent.json"))).toEqual([]);
    expect(await grok("grok-stop", fixture("stop.json", { stopHookActive: true }))).toEqual([]);
    expect(await grok("grok-stop", fixture("stop.json", { reason: "max_tokens" }))).toEqual([]);
  });
});

describe("other harnesses' hooks stand down under Grok", () => {
  it("a Cursor hook called by Grok does nothing and still allows the prompt", async () => {
    const out: string[] = [];
    const program = new Command();
    const cursorPayload = { conversation_id: "c1", workspace_roots: ["/repo/web"], prompt: "x" };
    registerCursorHookCommands(program.command("hook"), host(cursorPayload, out, { GROK_HOOK_EVENT: "UserPromptSubmit" }));
    await program.parseAsync(["hook", "cursor-session-start"], { from: "user" });
    expect(out).toEqual(["{}"]);
    expect(agentsRepo.findAgent(db, "cursor@web")).toBeUndefined();
  });
});

describe("Claude and Codex hooks stand down under Grok", () => {
  it("does not register claude@ or codex@ agents for a Grok session", async () => {
    for (const command of ["session-start", "codex-session-start"]) {
      const program = new Command();
      const claudePayload = { session_id: "s1", cwd: "/repo/web", hook_event_name: "SessionStart" };
      const payloadHost = host(claudePayload, []);
      registerHookCommands(program, {
        withDb: (run) => run(db, REPO),
        status: () => () => undefined,
        readStdinJson: () => Promise.resolve(claudePayload),
        env: { GROK_HOOK_EVENT: "SessionStart" },
        wakeCodex: () => false,
        notify: () => undefined,
        payloadHost,
      });
      await program.parseAsync(["hook", command], { from: "user" });
    }
    expect(agentsRepo.findAgent(db, "claude@web")).toBeUndefined();
    expect(agentsRepo.findAgent(db, "codex@web")).toBeUndefined();
  });
});

describe("MCP server instructions for Grok", () => {
  it("carry the exact monitor command, and only for Grok", async () => {
    const text = harnessInstructions("grok", "grok@web", LAUNCHER);
    expect(text).toContain(`"${LAUNCHER}" inbox watch --agent grok@web --provider grok`);
    expect(harnessInstructions("claude", "claude@web", LAUNCHER)).toBeUndefined();
    const server = createServer({ db, agentId: "grok@web", repoRoot: REPO, nativeSession: null, rulesTextSent: false }, text);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "grok", version: "1" });
    await client.connect(a);
    expect(client.getInstructions()).toBe(text);
  });
});
