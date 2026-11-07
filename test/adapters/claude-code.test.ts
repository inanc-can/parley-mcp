import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AdapterEnv } from "../../src/adapters/index.js";
import { claudeCodeAdapter } from "../../src/adapters/claude-code/index.js";
import { PLUGIN_DIR_REL } from "../../src/adapters/claude-code/plugin-files.js";

let home = "";

const jsonObject = z.record(z.string(), z.unknown());

function readJson(path: string): Record<string, unknown> {
  return jsonObject.parse(JSON.parse(readFileSync(path, "utf8")));
}

function env(): AdapterEnv {
  return { home };
}

function claudeJson(): string {
  return join(home, ".claude.json");
}

function pluginFile(rel: string): string {
  return join(home, PLUGIN_DIR_REL, rel);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-cc-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("claude-code install", () => {
  it("writes the MCP server entry and the plugin files", async () => {
    await claudeCodeAdapter.install(env(), false);

    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    expect(servers["parley"]).toEqual({ command: "npx", args: ["parley-mcp", "serve"] });

    expect(existsSync(pluginFile(join(".claude-plugin", "plugin.json")))).toBe(true);
    expect(existsSync(pluginFile(join("hooks", "hooks.json")))).toBe(true);
    expect(existsSync(pluginFile(join("monitors", "monitors.json")))).toBe(true);
    expect(existsSync(pluginFile(join("scripts", "monitor.sh")))).toBe(true);
    expect(existsSync(pluginFile(join("scripts", "session-start.sh")))).toBe(true);

    const manifest = readJson(pluginFile(join(".claude-plugin", "plugin.json")));
    expect(manifest["name"]).toBe("parley");
    expect(jsonObject.parse(manifest["experimental"])["monitors"]).toBe("./monitors/monitors.json");

    const hooks = readJson(pluginFile(join("hooks", "hooks.json")));
    expect(Object.keys(jsonObject.parse(hooks["hooks"])).sort()).toEqual(
      ["PostToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("is a no-op on a second run (byte for byte)", async () => {
    await claudeCodeAdapter.install(env(), false);
    const firstConfig = readFileSync(claudeJson(), "utf8");
    const firstHooks = readFileSync(pluginFile(join("hooks", "hooks.json")), "utf8");

    const report = await claudeCodeAdapter.install(env(), false);
    expect(report.changes).toEqual([]);
    expect(readFileSync(claudeJson(), "utf8")).toBe(firstConfig);
    expect(readFileSync(pluginFile(join("hooks", "hooks.json")), "utf8")).toBe(firstHooks);
  });

  it("dry-run writes nothing", async () => {
    const report = await claudeCodeAdapter.install(env(), true);
    expect(report.dryRun).toBe(true);
    expect(report.changes.length).toBeGreaterThan(0);
    expect(existsSync(claudeJson())).toBe(false);
    expect(existsSync(pluginFile(join("hooks", "hooks.json")))).toBe(false);
  });
});

describe("claude-code install merges into existing ~/.claude.json", () => {
  it("keeps unrelated top-level keys and other mcpServers", async () => {
    const original = {
      numStartups: 7,
      mcpServers: { other: { command: "x", args: [] } },
    };
    writeFileSync(claudeJson(), `${JSON.stringify(original, null, 2)}\n`, "utf8");

    await claudeCodeAdapter.install(env(), false);
    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    expect(config["numStartups"]).toBe(7);
    expect(servers["other"]).toEqual({ command: "x", args: [] });
    expect(servers["parley"]).toBeDefined();
  });
});

describe("claude-code uninstall", () => {
  it("removes exactly what install created when it created the file", async () => {
    await claudeCodeAdapter.install(env(), false);
    expect(existsSync(claudeJson())).toBe(true);

    await claudeCodeAdapter.uninstall(env());
    // The config existed only for us -> gone; the plugin tree -> gone.
    expect(existsSync(claudeJson())).toBe(false);
    expect(existsSync(pluginFile(join("hooks", "hooks.json")))).toBe(false);
    expect(existsSync(join(home, PLUGIN_DIR_REL))).toBe(false);
  });

  it("restores a pre-existing ~/.claude.json byte for byte", async () => {
    const original = `${JSON.stringify(
      { numStartups: 7, mcpServers: { other: { command: "x", args: [] } } },
      null,
      2,
    )}\n`;
    writeFileSync(claudeJson(), original, "utf8");

    await claudeCodeAdapter.install(env(), false);
    await claudeCodeAdapter.uninstall(env());

    expect(readFileSync(claudeJson(), "utf8")).toBe(original);
  });

  it("leaves a pre-existing unrelated file under ~/.claude intact", async () => {
    // A user file inside ~/.claude that is NOT part of the plugin tree.
    mkdirSync(join(home, ".claude"), { recursive: true });
    const userFile = join(home, ".claude", "settings.json");
    writeFileSync(userFile, "{}\n", "utf8");

    await claudeCodeAdapter.install(env(), false);
    await claudeCodeAdapter.uninstall(env());

    expect(existsSync(userFile)).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(true);
    // Plugin tree still cleaned up.
    expect(existsSync(join(home, PLUGIN_DIR_REL))).toBe(false);
  });
});

describe("claude-code doctor", () => {
  it("reports not-wired before setup and wired after", async () => {
    const before = await claudeCodeAdapter.doctor(env());
    expect(before.canWakeIdle).toBe(false);
    expect(before.hooksTrusted).toBeNull();
    expect(before.detail).toContain("run setup");

    await claudeCodeAdapter.install(env(), false);
    const after = await claudeCodeAdapter.doctor(env());
    expect(after.canWakeIdle).toBe(true);
    expect(after.installed).toBe(true);
    expect(after.detail).toContain("wakes idle");
  });
});

describe("claude-code detect", () => {
  it("reports installed when ~/.claude exists", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    const report = await claudeCodeAdapter.detect(env());
    expect(report.installed).toBe(true);
  });

  it("reports not installed on a clean HOME", async () => {
    const report = await claudeCodeAdapter.detect(env());
    expect(report.installed).toBe(false);
  });
});
