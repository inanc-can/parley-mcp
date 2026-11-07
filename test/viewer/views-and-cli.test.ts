import { describe, expect, it } from "vitest";
import { parsePort, runViewer } from "../../src/cli/commands/viewer.js";
import { openMemoryDb } from "../../src/store/index.js";
import type { ViewerOptions } from "../../src/viewer/server.js";
import { groupMessages, receiptLabel, type Message } from "../../src/viewer/static/views.js";

function msg(over: Partial<Message>): Message {
  return {
    id: "m",
    from: "you",
    to: "claude@web",
    kind: "text",
    body: "hi",
    replyTo: null,
    status: "sent",
    sentAt: 1,
    deliveredAt: null,
    readAt: null,
    repliedAt: null,
    failedAt: null,
    estTokens: 1,
    ...over,
  };
}

describe("page helpers", () => {
  it("groups one post fanned out to several agents into one bubble", () => {
    const groups = groupMessages([
      msg({ id: "a", to: "claude@web" }),
      msg({ id: "b", to: "codex@api", status: "read" }),
      msg({ id: "c", from: "codex@api", to: "claude@web", body: "ok", sentAt: 2 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.rows.map((r) => r.to)).toEqual(["claude@web", "codex@api"]);
  });

  it("labels every receipt state", () => {
    const statuses: Message["status"][] = ["sent", "delivered", "read", "replied", "failed"];
    expect(statuses.map((status) => receiptLabel(status))).toEqual([
      "✓ sent",
      "✓✓ delivered",
      "✓✓ read",
      "↩ replied",
      "✗ failed",
    ]);
  });
});

describe("mcp-parley viewer", () => {
  it("starts on the given port, prints the tokened URL and opens the browser", async () => {
    const lines: string[] = [];
    const launched: string[] = [];
    let seen: ViewerOptions | undefined;
    const db = openMemoryDb();
    await runViewer({
      db,
      repoRoot: "/repo",
      home: "/nonexistent-home",
      write: (l) => lines.push(l),
      port: 4321,
      openBrowser: true,
      launch: (url) => launched.push(url),
      start: (options) => {
        seen = options;
        return Promise.resolve({ url: "http://127.0.0.1:4321/?token=t", port: 4321, token: "t", close: () => Promise.resolve() });
      },
    });
    expect(seen?.port).toBe(4321);
    expect(seen?.repoRoot).toBe("/repo");
    expect(lines.join("\n")).toContain("http://127.0.0.1:4321/?token=t");
    expect(launched).toEqual(["http://127.0.0.1:4321/?token=t"]);
    // Export goes through the CLI's own exporter.
    expect(seen?.exportLines?.("md").join("\n")).toContain("#");
    // No launcher written under this HOME, so a Codex wake cannot start.
    expect(seen?.wakeRecipient?.("codex@api", "codex")).toBe(false);
    expect(seen?.wakeRecipient?.("claude@web", "claude")).toBe(false);
    db.close();
  });

  it("parses --port strictly", () => {
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort(undefined)).toBeUndefined();
    expect(parsePort("0")).toBeUndefined();
    expect(parsePort("70000")).toBeUndefined();
    expect(parsePort("abc")).toBeUndefined();
  });
});
