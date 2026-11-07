import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  agentsRepo,
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
} from "../../src/cli/commands/hook-events.js";
import {
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
  "claude-code",
  "fixtures",
);

const REPO = "/home/synthetic/repo";
const AGENT = "claude@api";

const syntheticSchema = z.looseObject({ _synthetic: z.boolean() });
const promptFixtureSchema = z.looseObject({ prompt: z.string() });

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
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
    fromAgent: "codex@api",
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

describe("every fixture is marked synthetic", () => {
  it("carries _synthetic: true so it is never mistaken for a real capture", () => {
    for (const name of [
      "session-start.json",
      "user-prompt.json",
      "stop.json",
      "post-tool-edit.json",
      "subagent-post-tool.json",
      "session-end.json",
    ]) {
      const payload = loadFixture(name);
      expect(syntheticSchema.parse(payload)._synthetic).toBe(true);
    }
  });
});

describe("replay session-start fixture", () => {
  it("registers the agent", () => {
    const db = openMemoryDb();
    const payload = sessionStartPayloadSchema.parse(loadFixture("session-start.json"));
    runHookSessionStart({ db, repoRoot: REPO, write: collector().write, now: 5_000 }, payload);
    expect(agentsRepo.findAgent(db, AGENT)?.id).toBe(AGENT);
    db.close();
  });
});

describe("replay user-prompt fixture", () => {
  it("marks the referenced message read", () => {
    const db = openMemoryDb();
    const id = seedSentMessage(db, AGENT);
    const raw = promptFixtureSchema.parse(loadFixture("user-prompt.json"));
    const payload = userPromptPayloadSchema.parse({
      ...raw,
      prompt: raw.prompt.replace("__MESSAGE_ID__", id),
    });
    const read = runHookUserPrompt({ db, repoRoot: REPO, write: collector().write, now: 6_000 }, payload);
    expect(read).toBe(1);
    expect(messagesRepo.getMessage(db, id).status).toBe("read");
    db.close();
  });
});

describe("replay subagent fixture", () => {
  it("is ignored (no delivery, no edit recorded)", () => {
    const db = openMemoryDb();
    const id = seedSentMessage(db, AGENT);
    const payload = postToolPayloadSchema.parse(loadFixture("subagent-post-tool.json"));
    const out = collector();
    runHookPostTool({ db, repoRoot: REPO, write: out.write, now: 7_000 }, payload);
    expect(messagesRepo.getMessage(db, id).status).toBe("sent");
    expect(out.lines.join("\n")).toContain("ignored subagent payload");
    db.close();
  });
});

describe("replay session-end fixture", () => {
  it("parses and requeues zero when nothing is delivered", () => {
    const db = openMemoryDb();
    const payload = sessionEndPayloadSchema.parse(loadFixture("session-end.json"));
    const requeued = runHookSessionEnd({ db, repoRoot: REPO, write: collector().write }, payload);
    expect(requeued).toBe(0);
    db.close();
  });
});
