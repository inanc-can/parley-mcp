import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { launcherPath } from "../../src/adapters/cli-path.js";
import { cursorAdapter } from "../../src/adapters/cursor/index.js";
import { doctorCursor, installCursor, uninstallCursor } from "../../src/adapters/cursor/install.js";

let home = "";
const env = () => ({ home });
const mcpJson = () => join(home, ".cursor", "mcp.json");
const hooksJson = () => join(home, ".cursor", "hooks.json");

const hooksFile = z.object({
  version: z.number(),
  hooks: z.record(z.string(), z.array(z.looseObject({ command: z.string() }))),
});
const mcpFile = z.object({ mcpServers: z.record(z.string(), z.looseObject({ command: z.string() })) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-cursor-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("cursor install", () => {
  it("writes the MCP server and every hook, pointing at the absolute launcher", () => {
    const report = installCursor(env(), false);
    expect(report.changes.map((c) => c.path)).toEqual([launcherPath(home), mcpJson(), hooksJson()]);
    const mcp = mcpFile.parse(JSON.parse(readFileSync(mcpJson(), "utf8")));
    expect(mcp.mcpServers["mcp-parley"]).toEqual({
      command: launcherPath(home),
      args: ["serve"],
      env: { PARLEY_HARNESS: "cursor" },
    });
    const hooks = hooksFile.parse(JSON.parse(readFileSync(hooksJson(), "utf8")));
    expect(hooks.version).toBe(1);
    expect(Object.keys(hooks.hooks).sort()).toEqual(["afterFileEdit", "beforeSubmitPrompt", "sessionEnd", "sessionStart", "stop"]);
    expect(hooks.hooks["sessionStart"]?.[0]?.command).toBe(`"${launcherPath(home)}" hook cursor-session-start`);
    // Cursor caps stop follow-ups at 5 per chat by default; Parley lifts it and relies on its own guards.
    expect(hooks.hooks["stop"]?.[0]).toMatchObject({ loop_limit: null });
    for (const file of [mcpJson(), hooksJson()]) {
      expect(readFileSync(file, "utf8")).not.toContain("npx");
    }
  });

  it("is idempotent", () => {
    installCursor(env(), false);
    const before = [readFileSync(mcpJson(), "utf8"), readFileSync(hooksJson(), "utf8")];
    expect(installCursor(env(), false).changes).toEqual([]);
    expect([readFileSync(mcpJson(), "utf8"), readFileSync(hooksJson(), "utf8")]).toEqual(before);
  });

  it("writes nothing on a dry run", () => {
    const report = installCursor(env(), true);
    expect(report.changes.length).toBeGreaterThan(0);
    expect(existsSync(join(home, ".cursor"))).toBe(false);
    expect(existsSync(launcherPath(home))).toBe(false);
  });

  it("keeps the user's own servers and hooks, and uninstall gives them back unchanged", () => {
    mkdirSync(join(home, ".cursor"));
    const userMcp = `${JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }, null, 2)}\n`;
    const userHooks = `${JSON.stringify({ version: 1, hooks: { stop: [{ command: "./audit.sh" }], afterFileEdit: [{ command: "./format.sh" }] } }, null, 2)}\n`;
    writeFileSync(mcpJson(), userMcp);
    writeFileSync(hooksJson(), userHooks);
    installCursor(env(), false);
    const hooks = hooksFile.parse(JSON.parse(readFileSync(hooksJson(), "utf8")));
    expect(hooks.hooks["stop"]?.map((h) => h.command)).toEqual(["./audit.sh", `"${launcherPath(home)}" hook cursor-stop`]);
    expect(mcpFile.parse(JSON.parse(readFileSync(mcpJson(), "utf8"))).mcpServers["github"]).toBeDefined();
    uninstallCursor(env());
    expect(readFileSync(mcpJson(), "utf8")).toBe(userMcp);
    expect(readFileSync(hooksJson(), "utf8")).toBe(userHooks);
    expect(existsSync(launcherPath(home))).toBe(false);
  });

  it("deletes files that only held Parley's entries", () => {
    installCursor(env(), false);
    uninstallCursor(env());
    expect(existsSync(join(home, ".cursor"))).toBe(false);
    expect(existsSync(join(home, ".mcp-parley"))).toBe(false);
  });

  it("never overwrites or removes a foreign mcp-parley server", () => {
    mkdirSync(join(home, ".cursor"));
    const foreign = `${JSON.stringify({ mcpServers: { "mcp-parley": { command: "/opt/other/thing" } } }, null, 2)}\n`;
    writeFileSync(mcpJson(), foreign);
    const report = installCursor(env(), false);
    expect(report.notes?.join(" ")).toContain("did not create");
    expect(readFileSync(mcpJson(), "utf8")).toBe(foreign);
    uninstallCursor(env());
    expect(readFileSync(mcpJson(), "utf8")).toBe(foreign);
  });
});

describe("cursor doctor and detect", () => {
  it("reports not wired before setup and can-wake-idle after, with trust not applicable", () => {
    const before = doctorCursor(env());
    expect(before).toMatchObject({ installed: false, canWakeIdle: false, hooksTrusted: null });
    expect(before.detail).toContain("run setup");
    installCursor(env(), false);
    const after = doctorCursor(env());
    expect(after).toMatchObject({ installed: true, canWakeIdle: true, hooksTrusted: null });
    expect(after.detail).toContain("background inbox watch");
  });

  it("reports cannot-wake-idle when a hook is missing or the command points elsewhere", () => {
    installCursor(env(), false);
    writeFileSync(hooksJson(), JSON.stringify({ version: 1, hooks: {} }));
    expect(doctorCursor(env()).canWakeIdle).toBe(false);
    installCursor(env(), false);
    const text = readFileSync(mcpJson(), "utf8").replace(launcherPath(home), "/elsewhere/.mcp-parley/bin/mcp-parley");
    writeFileSync(mcpJson(), text);
    expect(doctorCursor(env()).detail).toContain("does not point at this install");
  });

  it("detects Cursor by ~/.cursor", async () => {
    expect((await cursorAdapter.detect(env())).installed).toBe(false);
    mkdirSync(join(home, ".cursor"));
    expect((await cursorAdapter.detect(env())).installed).toBe(true);
  });
});
