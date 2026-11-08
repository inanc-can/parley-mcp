import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runInboxWatchOnce } from "../../src/cli/commands/inbox.js";
import { registerCursorHookCommands, type PayloadHookHost } from "../../src/cli/cursor-hook-commands.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { adoptRootFolder, createServer } from "../../src/mcp/server.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { handleTalk } from "../../src/mcp/tools/talk.js";
import type { Notice } from "../../src/notify/os-notify.js";
import { agentsRepo, claimsRepo, messagesRepo, openMemoryDb, type Db } from "../../src/store/index.js";

const FIXTURES = join(process.cwd(), "src", "adapters", "cursor", "fixtures");
const SESSION = "c0ffee00-1111-2222-3333-444455556666";
const REPO = "/repo";
const LAUNCHER = "/home/u/.mcp-parley/bin/mcp-parley";

function fixture(name: string, override: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")));
  return { ...parsed, ...override };
}

let db: Db;
let notices: Notice[];

async function hook(command: string, payload: unknown): Promise<Record<string, unknown>> {
  const out: string[] = [];
  const host: PayloadHookHost = {
    withDbAt: (dir, run) => {
      expect(dir).toBe("/repo/web"); // the folder comes from workspace_roots, not the hook's cwd
      return run(db, REPO);
    },
    status: () => () => undefined,
    readStdinJson: () => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload)),
    write: (line) => out.push(line),
    env: {},
    launcher: LAUNCHER,
    notify: (n) => notices.push(n),
  };
  const program = new Command();
  registerCursorHookCommands(program.command("hook"), host);
  await program.parseAsync(["hook", command], { from: "user" });
  expect(out).toHaveLength(1); // exactly one JSON reply, always
  return z.record(z.string(), z.unknown()).parse(JSON.parse(out[0] ?? "null"));
}

async function sendToCursor(text: string, key: string): Promise<string> {
  registerCaller(db, "claude@api", REPO, "claude-1", Date.now());
  const ctx: ToolContext = { db, agentId: "claude@api", repoRoot: REPO, nativeSession: null, rulesTextSent: false };
  await handleTalk(ctx, { to: "cursor@web", text, idempotency_key: key });
  const pending = messagesRepo.listUndeliveredForRecipient(db, "cursor@web", Date.now());
  return pending[pending.length - 1]?.id ?? "";
}

beforeEach(() => {
  db = openMemoryDb();
  notices = [];
});

describe("cursor sessionStart", () => {
  it("registers cursor@<folder> for the chat and tells the agent to keep one inbox watch running", async () => {
    const reply = await hook("cursor-session-start", fixture("session-start.json"));
    const agent = agentsRepo.findAgentBySession(db, SESSION);
    expect(agent?.id).toBe("cursor@web");
    expect(reply["env"]).toEqual({ PARLEY_AGENT_ID: "cursor@web" });
    const context = String(reply["additional_context"]);
    expect(context).toContain(`"${LAUNCHER}" inbox watch --agent cursor@web --session ${SESSION} --once`);
    expect(context).toContain("background shell task");
    expect(context).toContain("reply_to");
  });

  it("ignores cloud background agents and payloads without a workspace", async () => {
    expect(await hook("cursor-session-start", fixture("background-session-start.json"))).toEqual({});
    expect(await hook("cursor-session-start", fixture("session-start.json", { workspace_roots: [] }))).toEqual({});
    expect(agentsRepo.findAgent(db, "cursor@web")).toBeUndefined();
  });

  it("still prints a reply when the payload is garbage", async () => {
    expect(await hook("cursor-prompt", new Error("bad stdin"))).toEqual({ continue: true });
    expect(await hook("cursor-stop", "not an object")).toEqual({});
  });
});

describe("cursor stop and prompt", () => {
  it("hands queued messages to Cursor as one follow-up, claims them, and never repeats them", async () => {
    await hook("cursor-session-start", fixture("session-start.json"));
    const id = await sendToCursor("can you take the login form?", "m1");
    const reply = await hook("cursor-stop", fixture("stop.json"));
    expect(String(reply["followup_message"])).toContain(`(id ${id})`);
    expect(String(reply["followup_message"])).toContain("reply_to");
    expect(messagesRepo.getMessage(db, id)).toMatchObject({ status: "delivered", delivered_session: SESSION });
    expect(await hook("cursor-stop", fixture("stop.json"))).toEqual({});
  });

  it("marks a message read when its id is in the submitted prompt, and always allows the prompt", async () => {
    await hook("cursor-session-start", fixture("session-start.json"));
    const id = await sendToCursor("hello", "m2");
    await hook("cursor-stop", fixture("stop.json"));
    const reply = await hook("cursor-prompt", fixture("prompt.json", { prompt: `mcp-parley message from claude@api (id ${id}): hello` }));
    expect(reply).toEqual({ continue: true });
    expect(messagesRepo.getMessage(db, id).status).toBe("read");
  });
});

describe("cursor afterFileEdit and sessionEnd", () => {
  it("records edits and warns both agents (and the human) on overlap", async () => {
    await hook("cursor-session-start", fixture("session-start.json"));
    registerCaller(db, "claude@api", REPO, null, Date.now());
    claimsRepo.insertClaim(db, { id: "c1", repoRoot: REPO, agentId: "claude@api", pathGlob: "/repo/web/src/auth/**", expiresAt: Date.now() + 60_000 });
    expect(await hook("cursor-after-edit", fixture("after-edit.json"))).toEqual({});
    expect(notices.map((n) => n.kind)).toEqual(["conflict"]);
  });

  it("requeues messages delivered to the chat that it never read", async () => {
    await hook("cursor-session-start", fixture("session-start.json"));
    const id = await sendToCursor("hello", "m3");
    await hook("cursor-stop", fixture("stop.json"));
    expect(await hook("cursor-session-end", fixture("session-end.json"))).toEqual({});
    expect(messagesRepo.getMessage(db, id).status).toBe("sent");
  });
});

describe("the background watch", () => {
  it("counts as a heartbeat while it waits, then prints one message and stops", async () => {
    await hook("cursor-session-start", fixture("session-start.json"));
    const lines: string[] = [];
    const t0 = 1_900_000_000_000;
    expect(runInboxWatchOnce({ db, repoRoot: REPO, write: (l) => lines.push(l), now: t0 }, "cursor@web", "monitor", SESSION).found).toBe(false);
    expect(agentsRepo.findAgent(db, "cursor@web")?.last_heartbeat).toBe(t0);
    const id = await sendToCursor("ping", "m4");
    expect(runInboxWatchOnce({ db, repoRoot: REPO, write: (l) => lines.push(l) }, "cursor@web", "monitor", SESSION).found).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`(id ${id})`);
  });
});

describe("MCP roots", () => {
  it("names a Cursor MCP server after the open folder the client reports", async () => {
    const ctx: ToolContext = { db, agentId: "cursor@home", repoRoot: "/home/u", nativeSession: null, rulesTextSent: false };
    const server = createServer(ctx);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "cursor", version: "1" }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: "file:///repo/web", name: "web" }] }));
    await client.connect(clientSide);
    const previous = process.env["PARLEY_HARNESS"];
    process.env["PARLEY_HARNESS"] = "cursor";
    try {
      await adoptRootFolder(server, ctx, () => REPO);
    } finally {
      if (previous === undefined) {
        delete process.env["PARLEY_HARNESS"];
      } else {
        process.env["PARLEY_HARNESS"] = previous;
      }
    }
    expect(ctx.agentId).toBe("cursor@web");
    expect(ctx.repoRoot).toBe(REPO);
    expect(agentsRepo.findAgent(db, "cursor@web")?.repo_root).toBe(REPO);
  });
});
