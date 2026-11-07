import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { basename, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { AdapterEnv } from "../../src/adapters/index.js";
import {
  doctorClaudeCode,
  installClaudeCode,
  uninstallClaudeCode,
} from "../../src/adapters/claude-code/install.js";
import {
  MARKETPLACE_DIR_REL,
  MONITOR_SCRIPT_REL,
  PLUGIN_SUBDIR,
} from "../../src/adapters/claude-code/plugin-files.js";
import type { CommandResult, CommandRunner } from "../../src/adapters/claude-code/runner.js";
import { resolveAgentId } from "../../src/mcp/identity.js";
import { claudeAgentId } from "../../src/cli/commands/hook-payloads.js";

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

function marketplaceFile(rel: string): string {
  return join(home, MARKETPLACE_DIR_REL, rel);
}

function pluginFilePath(rel: string): string {
  return marketplaceFile(join(PLUGIN_SUBDIR, rel));
}

/** A fake `claude` runner that records every invocation and returns canned output. */
class FakeRunner implements CommandRunner {
  calls: string[][] = [];
  listJson = "[]";
  run(args: readonly string[]): CommandResult {
    this.calls.push([...args]);
    if (args[0] === "plugin" && args[1] === "list") {
      return { code: 0, stdout: this.listJson, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  }
  sawSubcommand(...parts: string[]): boolean {
    return this.calls.some((call) => parts.every((p, i) => call[i] === p));
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-cc-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("claude-code install", () => {
  it("writes the MCP entry (with identity env) and the marketplace files", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);

    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    // Identity fix: PARLEY_HARNESS=claude so MCP tools act as claude@<folder>.
    expect(servers["parley"]).toEqual({
      command: "npx",
      args: ["parley-mcp", "serve"],
      env: { PARLEY_HARNESS: "claude" },
    });

    expect(existsSync(marketplaceFile(join(".claude-plugin", "marketplace.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join(".claude-plugin", "plugin.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("hooks", "hooks.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("monitors", "monitors.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("scripts", "monitor.sh")))).toBe(true);
  });

  it("runs validate, marketplace add and install through the runner", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    expect(runner.sawSubcommand("plugin", "validate")).toBe(true);
    expect(runner.sawSubcommand("plugin", "marketplace", "add")).toBe(true);
    expect(runner.sawSubcommand("plugin", "install", "parley@parley")).toBe(true);
  });

  it("registers PostToolUse exactly once", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    const hooks = readJson(pluginFilePath(join("hooks", "hooks.json")));
    const hookMap = jsonObject.parse(hooks["hooks"]);
    const postTool = z.array(z.unknown()).parse(hookMap["PostToolUse"]);
    expect(postTool.length).toBe(1);
  });

  it("the monitor retries (registers itself) instead of exiting when unregistered", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    const monitor = readFileSync(pluginFilePath(join("scripts", "monitor.sh")), "utf8");
    expect(monitor).toContain("inbox register");
    expect(monitor).toContain("while :;");
    // It must NOT give up with a bare `exit 0` on not-registered.
    expect(monitor).not.toContain("grep -q");
  });

  it("the MCP identity env resolves to the same agent id as the hooks", () => {
    const cwd = join(home, "my-repo");
    // Hooks derive claude@<folder> from cwd.
    const hookId = claudeAgentId(cwd);
    // The MCP server, launched with PARLEY_HARNESS=claude, resolves the same.
    const prev = process.env["PARLEY_HARNESS"];
    process.env["PARLEY_HARNESS"] = "claude";
    try {
      const mcpId = resolveAgentId(undefined, cwd);
      expect(mcpId).toBe(hookId);
      expect(mcpId).toBe(`claude@${basename(cwd)}`);
    } finally {
      if (prev === undefined) {
        delete process.env["PARLEY_HARNESS"];
      } else {
        process.env["PARLEY_HARNESS"] = prev;
      }
    }
  });

  it("is a no-op on files on a second run (byte for byte)", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    const firstConfig = readFileSync(claudeJson(), "utf8");
    const firstHooks = readFileSync(pluginFilePath(join("hooks", "hooks.json")), "utf8");

    const report = installClaudeCode(env(), false, runner);
    expect(report.changes).toEqual([]);
    expect(readFileSync(claudeJson(), "utf8")).toBe(firstConfig);
    expect(readFileSync(pluginFilePath(join("hooks", "hooks.json")), "utf8")).toBe(firstHooks);
  });

  it("dry-run writes nothing and runs no commands", () => {
    const runner = new FakeRunner();
    const report = installClaudeCode(env(), true, runner);
    expect(report.dryRun).toBe(true);
    expect(report.changes.length).toBeGreaterThan(0);
    expect(existsSync(claudeJson())).toBe(false);
    expect(existsSync(pluginFilePath(join("hooks", "hooks.json")))).toBe(false);
    expect(runner.calls.length).toBe(0);
  });
});

describe("claude-code install merges into existing ~/.claude.json", () => {
  it("keeps unrelated top-level keys and other mcpServers", () => {
    const original = {
      numStartups: 7,
      mcpServers: { other: { command: "x", args: [] } },
    };
    writeFileSync(claudeJson(), `${JSON.stringify(original, null, 2)}\n`, "utf8");

    installClaudeCode(env(), false, new FakeRunner());
    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    expect(config["numStartups"]).toBe(7);
    expect(servers["other"]).toEqual({ command: "x", args: [] });
    expect(servers["parley"]).toBeDefined();
  });
});

describe("claude-code uninstall", () => {
  it("unregisters through the runner and removes exactly what install created", () => {
    installClaudeCode(env(), false, new FakeRunner());
    expect(existsSync(claudeJson())).toBe(true);

    const runner = new FakeRunner();
    uninstallClaudeCode(env(), runner);
    expect(runner.sawSubcommand("plugin", "uninstall", "parley@parley")).toBe(true);
    expect(runner.sawSubcommand("plugin", "marketplace", "remove", "parley")).toBe(true);
    // The config existed only for us -> gone; the marketplace tree -> gone.
    expect(existsSync(claudeJson())).toBe(false);
    expect(existsSync(join(home, MARKETPLACE_DIR_REL))).toBe(false);
  });

  it("restores a pre-existing ~/.claude.json byte for byte", () => {
    const original = `${JSON.stringify(
      { numStartups: 7, mcpServers: { other: { command: "x", args: [] } } },
      null,
      2,
    )}\n`;
    writeFileSync(claudeJson(), original, "utf8");

    installClaudeCode(env(), false, new FakeRunner());
    uninstallClaudeCode(env(), new FakeRunner());

    expect(readFileSync(claudeJson(), "utf8")).toBe(original);
  });

  it("leaves a pre-existing unrelated file under ~/.parley-mcp intact", () => {
    mkdirSync(join(home, ".parley-mcp"), { recursive: true });
    const userFile = join(home, ".parley-mcp", "hub.db");
    writeFileSync(userFile, "db\n", "utf8");

    installClaudeCode(env(), false, new FakeRunner());
    uninstallClaudeCode(env(), new FakeRunner());

    expect(existsSync(userFile)).toBe(true);
    expect(existsSync(join(home, MARKETPLACE_DIR_REL))).toBe(false);
  });
});

describe("claude-code doctor", () => {
  it("reports not-wired before setup", () => {
    const before = doctorClaudeCode(env(), new FakeRunner());
    expect(before.canWakeIdle).toBe(false);
    expect(before.hooksTrusted).toBeNull();
    expect(before.detail).toContain("run setup");
  });

  it("reports can-wake-idle only when the plugin is installed AND enabled", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);

    // Files present but `claude plugin list` shows nothing -> cannot wake.
    const empty = new FakeRunner();
    empty.listJson = "[]";
    expect(doctorClaudeCode(env(), empty).canWakeIdle).toBe(false);

    // Files present AND plugin installed+enabled -> can wake.
    const ready = new FakeRunner();
    ready.listJson = JSON.stringify([{ name: "parley", enabled: true }]);
    expect(doctorClaudeCode(env(), ready).canWakeIdle).toBe(true);
  });

  it("reports cannot-wake-idle when the monitor script is missing", () => {
    const ready = new FakeRunner();
    ready.listJson = JSON.stringify([{ name: "parley", enabled: true }]);
    installClaudeCode(env(), false, ready);
    // Remove just the monitor script.
    rmSync(join(home, MARKETPLACE_DIR_REL, MONITOR_SCRIPT_REL));
    const report = doctorClaudeCode(env(), ready);
    expect(report.canWakeIdle).toBe(false);
    expect(report.detail).toContain("monitor script missing");
  });
});

describe("claude-code detect", () => {
  it("reports not installed on a clean HOME", async () => {
    const { claudeCodeAdapter } = await import("../../src/adapters/claude-code/index.js");
    const report = await claudeCodeAdapter.detect(env());
    expect(report.installed).toBe(false);
  });

  it("reports installed when ~/.claude exists", async () => {
    const { claudeCodeAdapter } = await import("../../src/adapters/claude-code/index.js");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const report = await claudeCodeAdapter.detect(env());
    expect(report.installed).toBe(true);
  });
});
