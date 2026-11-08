import { beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerHookCommands, type HookCommandHost } from "../../src/cli/hook-commands.js";
import { silentNotifier } from "../../src/notify/os-notify.js";
import { registerCaller } from "../../src/mcp/identity.js";
import { handleTalk } from "../../src/mcp/tools/talk.js";
import { openMemoryDb, type Db } from "../../src/store/index.js";

const REPO = "/repo";
const THREAD = "01a1b7e3-c7c2-7e81-bd49-a411267a3bb9";
let db: Db;

function stopPayload(): Record<string, unknown> {
  return {
    session_id: THREAD,
    turn_id: "turn-1",
    cwd: "/repo/api",
    hook_event_name: "Stop",
    model: "m",
    permission_mode: "default",
    stop_hook_active: false,
  };
}

async function runStop(wakes: string[]): Promise<void> {
  const host: HookCommandHost = {
    withDb: (run) => run(db, REPO),
    status: () => () => undefined,
    readStdinJson: () => Promise.resolve(stopPayload()),
    wakeCodex: (agentId, waitSeconds) => {
      wakes.push(`${agentId}:${String(waitSeconds)}`);
      return true;
    },
    notify: silentNotifier,
    env: {},
    payloadHost: {
      withDbAt: (_dir, run) => run(db, REPO),
      status: () => () => undefined,
      readStdinJson: () => Promise.resolve({}),
      write: () => undefined,
      env: {},
      launcher: "/l",
      notify: silentNotifier,
    },
  };
  const program = new Command();
  registerHookCommands(program, host);
  await program.parseAsync(["hook", "codex-stop"], { from: "user" });
}

beforeEach(() => {
  db = openMemoryDb();
  registerCaller(db, "codex@api", REPO, THREAD, Date.now());
  registerCaller(db, "claude@web", REPO, "claude-session", Date.now());
});

describe("codex Stop hook backstop", () => {
  it("starts a wake when messages arrived during the turn", async () => {
    await handleTalk(
      { db, agentId: "claude@web", repoRoot: REPO, nativeSession: null, rulesTextSent: false },
      { to: "codex@api", text: "while you were busy", idempotency_key: "s1" },
    );
    const wakes: string[] = [];
    await runStop(wakes);
    expect(wakes).toEqual(["codex@api:120"]);
  });

  it("starts nothing when the inbox is empty", async () => {
    const wakes: string[] = [];
    await runStop(wakes);
    expect(wakes).toEqual([]);
  });
});
