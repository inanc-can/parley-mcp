import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  agentsRepo,
  editsRepo,
  messagesRepo,
  openMemoryDb,
  threadsRepo,
  type Db,
} from "../../src/store/index.js";
import {
  runHookPostTool,
  runHookSessionEnd,
  runHookSessionStart,
  runHookUserPrompt,
  type HookEventDeps,
} from "../../src/cli/commands/hook-events.js";
import {
  codexAgentId,
  postToolPayloadSchema,
  sessionEndPayloadSchema,
  sessionStartPayloadSchema,
  userPromptPayloadSchema,
} from "../../src/cli/commands/hook-payloads.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "adapters",
  "codex",
  "fixtures",
);

const REPO = "/home/synthetic/repo";
const AGENT = "codex@api"; // basename of the fixture cwd /home/synthetic/repo/api

/** The harness-specific deps that make the shared handlers act as Codex. */
const CODEX: Pick<HookEventDeps, "agentIdForCwd" | "editTools"> = {
  agentIdForCwd: codexAgentId,
  editTools: new Set(["Edit", "Write", "MultiEdit", "apply_patch"]),
};

const syntheticSchema = z.looseObject({ _synthetic: z.boolean() });
const promptFixtureSchema = z.looseObject({ prompt: z.string() });

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function collector(): { lines: string[]; status: (line: string) => void } {
  const lines: string[] = [];
  return { lines, status: (line) => lines.push(line) };
}

function seedSentMessage(db: Db, to: string): string {
  const threadId = randomUUID();
  threadsRepo.createThread(db, {
    id: threadId,
    repoRoot: REPO,
    title: "t",
    status: "open",
    messageCap: 20,
    createdAt: 1_000,
  });
  const id = randomUUID();
  messagesRepo.insertMessage(db, {
    id,
    threadId,
    fromAgent: "claude@web",
    toAgent: to,
    kind: "text",
    body: "hi",
    payloadJson: null,
    replyTo: null,
    status: "sent",
    sentAt: 1_100,
    expiresAt: 10_000_000_000_000,
    idempotencyKey: randomUUID(),
    estTokens: 4,
  });
  return id;
}

describe("every codex fixture is marked synthetic", () => {
  it("carries _synthetic: true so it is never mistaken for a real capture", () => {
    for (const name of [
      "session-start.json",
      "user-prompt.json",
      "stop.json",
      "post-tool-edit.json",
      "subagent-post-tool.json",
      "session-end.json",
    ]) {
      expect(syntheticSchema.parse(loadFixture(name))._synthetic).toBe(true);
    }
  });
});

describe("replay codex session-start fixture", () => {
  it("registers codex@api", () => {
    const db = openMemoryDb();
    const payload = sessionStartPayloadSchema.parse(loadFixture("session-start.json"));
    runHookSessionStart({ db, repoRoot: REPO, status: collector().status, now: 5_000, ...CODEX }, payload);
    expect(agentsRepo.findAgent(db, AGENT)?.id).toBe(AGENT);
    db.close();
  });
});

describe("replay codex user-prompt fixture", () => {
  it("marks the referenced message read", () => {
    const db = openMemoryDb();
    const id = seedSentMessage(db, AGENT);
    const raw = promptFixtureSchema.parse(loadFixture("user-prompt.json"));
    const payload = userPromptPayloadSchema.parse({
      ...raw,
      prompt: raw.prompt.replace("__MESSAGE_ID__", id),
    });
    const read = runHookUserPrompt(
      { db, repoRoot: REPO, status: collector().status, now: 6_000, ...CODEX },
      payload,
    );
    expect(read).toBe(1);
    expect(messagesRepo.getMessage(db, id).status).toBe("read");
    db.close();
  });
});

describe("replay codex post-tool edit fixture", () => {
  it("records an apply_patch edit (Codex's edit tool) without throwing", () => {
    const db = openMemoryDb();
    agentsRepo.upsertAgent(db, {
      id: AGENT,
      harness: "codex",
      folder: "api",
      repoRoot: REPO,
      nativeSession: "codex-sess-0001",
      lastHeartbeat: 1_000,
      createdAt: 1_000,
    });
    const payload = postToolPayloadSchema.parse(loadFixture("post-tool-edit.json"));
    const out = collector();
    runHookPostTool({ db, repoRoot: REPO, status: out.status, now: 7_000, ...CODEX }, payload);
    expect(out.lines.join("\n")).toContain("post-tool");
    // apply_patch carries its files inside the patch, relative to the payload's cwd (verified in
    // openai/codex); both land repo-relative under api/.
    for (const path of ["api/src/server.ts", "api/src/routes/health.ts"]) {
      expect(editsRepo.listRecentEditsForPath(db, REPO, path, 0).map((e) => e.agent_id)).toEqual([AGENT]);
    }
    db.close();
  });
});

describe("replay codex subagent fixture", () => {
  it("is ignored (no edit recorded, no delivery)", () => {
    const db = openMemoryDb();
    const id = seedSentMessage(db, AGENT);
    const payload = postToolPayloadSchema.parse(loadFixture("subagent-post-tool.json"));
    const out = collector();
    runHookPostTool({ db, repoRoot: REPO, status: out.status, now: 7_000, ...CODEX }, payload);
    expect(messagesRepo.getMessage(db, id).status).toBe("sent");
    expect(out.lines.join("\n")).toContain("ignored subagent payload");
    db.close();
  });
});

describe("replay codex session-end fixture", () => {
  it("parses and requeues zero when nothing is delivered", () => {
    const db = openMemoryDb();
    const payload = sessionEndPayloadSchema.parse(loadFixture("session-end.json"));
    const requeued = runHookSessionEnd(
      { db, repoRoot: REPO, status: collector().status, ...CODEX },
      payload,
    );
    expect(requeued).toBe(0);
    db.close();
  });
});
