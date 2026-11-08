import { beforeEach, describe, expect, it } from "vitest";
import { runHookPostTool, type HookEventDeps } from "../../src/cli/commands/hook-events.js";
import { runCursorHook } from "../../src/cli/commands/cursor-hooks.js";
import { runGrokHook } from "../../src/cli/commands/grok-hooks.js";
import { CONFLICT_REPEAT_MS } from "../../src/cli/commands/hook.js";
import { registerCaller } from "../../src/mcp/identity.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { handleAgree } from "../../src/mcp/tools/agree.js";
import type { Notice } from "../../src/notify/os-notify.js";
import { messagesRepo, openMemoryDb, threadsRepo, type Db } from "../../src/store/index.js";

/**
 * M10 (PLAN section 10): claims and overlap from real edits, through each
 * harness's own edit hook and its own way of naming the file. Two agents edit
 * the same file -> both get a warning in the file's thread at once and the
 * human gets one notification.
 */

const REPO = "/repo";
const T0 = 1_900_000_000_000;
let db: Db;
let notices: Notice[];
let wakes: string[];

function sharedDeps(now: number, harness: "claude" | "codex"): HookEventDeps {
  return {
    db,
    repoRoot: REPO,
    status: () => undefined,
    now,
    notify: (n) => notices.push(n),
    wakeRecipient: (id, h) => {
      wakes.push(`${id}:${h}`);
      return true;
    },
    agentIdForCwd: (cwd) => `${harness}@${cwd.split("/").pop() ?? ""}`,
    editTools: new Set(["Edit", "Write", "MultiEdit", "apply_patch"]),
  };
}

function claudeEdits(now: number, absolutePath: string): void {
  runHookPostTool(sharedDeps(now, "claude"), {
    session_id: "claude-1",
    cwd: "/repo/web",
    tool_name: "Edit",
    tool_input: { file_path: absolutePath },
  });
}

function codexPatches(now: number, relativeFile: string): void {
  runHookPostTool(sharedDeps(now, "codex"), {
    session_id: "codex-1",
    cwd: "/repo/api",
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Update File: ${relativeFile}\n@@\n-a\n+b\n*** End Patch\n` },
  });
}

function warnings(path: string): { to: string; at: number }[] {
  const thread = threadsRepo.listThreadsByRepo(db, REPO).find((t) => t.title === `conflict: ${path}`);
  return thread === undefined
    ? []
    : messagesRepo.listThreadMessages(db, thread.id).map((m) => ({ to: m.to_agent, at: m.sent_at }));
}

beforeEach(() => {
  db = openMemoryDb();
  notices = [];
  wakes = [];
  registerCaller(db, "claude@web", REPO, "claude-1", T0);
  registerCaller(db, "codex@api", REPO, "codex-1", T0);
  registerCaller(db, "cursor@web", REPO, "cursor-1", T0);
  registerCaller(db, "grok@web", REPO, "grok-1", T0);
});

describe("two agents edit the same file", () => {
  it("Claude (absolute path) and Codex (path inside a patch) meet on one repo-relative file", () => {
    claudeEdits(T0, "/repo/shared/config.ts");
    expect(warnings("shared/config.ts")).toEqual([]);
    codexPatches(T0 + 1_000, "../shared/config.ts");
    const got = warnings("shared/config.ts");
    expect(got.map((w) => w.to).sort()).toEqual(["claude@web", "codex@api"]);
    expect(got.every((w) => w.at === T0 + 1_000)).toBe(true); // in the same hook call: well within 5 s
    expect(notices.map((n) => n.kind)).toEqual(["conflict"]);
    // The Codex agent is woken through the app-server so it sees the warning now.
    expect(wakes).toContain("codex@api:codex");
  });

  it("does not repeat the warning for 10 minutes, then warns again", () => {
    claudeEdits(T0, "/repo/shared/config.ts");
    codexPatches(T0 + 1_000, "../shared/config.ts");
    claudeEdits(T0 + 60_000, "/repo/shared/config.ts");
    codexPatches(T0 + 120_000, "../shared/config.ts");
    expect(warnings("shared/config.ts")).toHaveLength(2);
    expect(notices).toHaveLength(1);
    claudeEdits(T0 + 1_000 + CONFLICT_REPEAT_MS + 1, "/repo/shared/config.ts");
    expect(warnings("shared/config.ts")).toHaveLength(4);
    expect(notices).toHaveLength(2);
  });

  it("Cursor (absolute) and Grok (relative to its folder) meet too", () => {
    const cursor = { db, repoRoot: REPO, status: () => undefined, launcher: "/l", now: T0, notify: (n: Notice) => notices.push(n) };
    runCursorHook(cursor, "after-edit", { file_path: "/repo/web/src/app.ts" }, { session: "cursor-1", root: "/repo/web" });
    runGrokHook(
      { ...cursor, now: T0 + 500 },
      "post-tool",
      { toolName: "edit_file", toolInput: { path: "src/app.ts" } },
      { session: "grok-1", folder: "/repo/web" },
    );
    expect(warnings("web/src/app.ts").map((w) => w.to).sort()).toEqual(["cursor@web", "grok@web"]);
    expect(notices.map((n) => n.kind)).toEqual(["conflict"]);
  });

  it("ignores edits outside the repo", () => {
    claudeEdits(T0, "/etc/hosts");
    codexPatches(T0 + 1_000, "/etc/hosts");
    expect(threadsRepo.listThreadsByRepo(db, REPO)).toEqual([]);
  });
});

describe("a claim meets an edit", () => {
  it("a glob claimed relative to the agent's folder catches another harness's edit of a file in it", () => {
    const claude: ToolContext = { db, agentId: "claude@web", repoRoot: REPO, nativeSession: null, rulesTextSent: false, cwd: "/repo/web" };
    const claimed = handleAgree(claude, { action: "claim", path_glob: "src/auth/**" }, T0);
    expect(JSON.stringify(claimed.value)).toContain("web/src/auth/**");
    runGrokHook(
      { db, repoRoot: REPO, status: () => undefined, launcher: "/l", now: T0 + 1_000, notify: (n) => notices.push(n) },
      "post-tool",
      { toolName: "write_file", toolInput: { path: "src/auth/login.ts" } },
      { session: "grok-1", folder: "/repo/web" },
    );
    expect(warnings("web/src/auth/login.ts").map((w) => w.to).sort()).toEqual(["claude@web", "grok@web"]);
    expect(notices).toHaveLength(1);
  });

  it("release and renew find the claim by the same normalized glob", () => {
    const claude: ToolContext = { db, agentId: "claude@web", repoRoot: REPO, nativeSession: null, rulesTextSent: false, cwd: "/repo/web" };
    handleAgree(claude, { action: "claim", path_glob: "./src/**" }, T0);
    expect(handleAgree(claude, { action: "renew", path_glob: "src/**" }, T0 + 1).isError).not.toBe(true);
    expect(handleAgree(claude, { action: "release", path_glob: "/repo/web/src/**" }, T0 + 2).isError).not.toBe(true);
  });
});
