import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { basename, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
import { launcherPath, LAUNCHER_REL } from "../../src/adapters/cli-path.js";
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

/** Every generated file's text, so we can assert none of them contain `npx`. */
function allGeneratedText(): string[] {
  const texts: string[] = [readFileSync(claudeJson(), "utf8")];
  const root = join(home, MARKETPLACE_DIR_REL);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        texts.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(root);
  if (existsSync(launcherPath(home))) {
    texts.push(readFileSync(launcherPath(home), "utf8"));
  }
  return texts;
}

/** A fake `claude` runner that records every invocation and returns canned output. */
class FakeRunner implements CommandRunner {
  calls: string[][] = [];
  listJson = "[]";
  failOn: string | null = null;
  run(args: readonly string[]): CommandResult {
    this.calls.push([...args]);
    if (this.failOn !== null && args.includes(this.failOn)) {
      return { code: 1, stdout: "", stderr: `boom: ${this.failOn}` };
    }
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
  it("writes the launcher, the MCP entry pointing at it, and the marketplace files", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);

    const launcher = launcherPath(home);
    expect(existsSync(launcher)).toBe(true);

    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    // The MCP command is the absolute launcher path (never `npx`), with the
    // identity env so the MCP tools act as claude@<folder>.
    expect(servers["parley"]).toEqual({
      command: launcher,
      args: ["serve"],
      env: { PARLEY_HARNESS: "claude" },
    });

    expect(existsSync(marketplaceFile(join(".claude-plugin", "marketplace.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join(".claude-plugin", "plugin.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("hooks", "hooks.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("monitors", "monitors.json")))).toBe(true);
    expect(existsSync(pluginFilePath(join("scripts", "monitor.sh")))).toBe(true);
  });

  it("generates NO file that runs npx (the security finding)", () => {
    installClaudeCode(env(), false, new FakeRunner());
    for (const text of allGeneratedText()) {
      expect(text).not.toContain("npx");
    }
    // Positive: the launcher is referenced in the hook/monitor scripts.
    const launcher = launcherPath(home);
    const monitor = readFileSync(pluginFilePath(join("scripts", "monitor.sh")), "utf8");
    const stop = readFileSync(pluginFilePath(join("scripts", "stop.sh")), "utf8");
    expect(monitor).toContain(launcher);
    expect(stop).toContain(launcher);
  });

  it("runs validate, marketplace add and install through the runner", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    expect(runner.sawSubcommand("plugin", "validate")).toBe(true);
    expect(runner.sawSubcommand("plugin", "marketplace", "add")).toBe(true);
    expect(runner.sawSubcommand("plugin", "install", "parley@parley")).toBe(true);
  });

  it("reports a non-zero `claude` step in the install report notes", () => {
    const runner = new FakeRunner();
    runner.failOn = "install";
    const report = installClaudeCode(env(), false, runner);
    expect(report.notes?.some((n) => n.includes("install failed"))).toBe(true);
  });

  it("registers PostToolUse exactly once", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    const hooks = readJson(pluginFilePath(join("hooks", "hooks.json")));
    const hookMap = jsonObject.parse(hooks["hooks"]);
    const postTool = z.array(z.unknown()).parse(hookMap["PostToolUse"]);
    expect(postTool.length).toBe(1);
  });

  it("the monitor passes --session (so delivered_session is recorded) and self-registers", () => {
    const runner = new FakeRunner();
    installClaudeCode(env(), false, runner);
    const monitor = readFileSync(pluginFilePath(join("scripts", "monitor.sh")), "utf8");
    expect(monitor).toContain("inbox register");
    expect(monitor).toContain("while :;");
    expect(monitor).toContain("--session");
    expect(monitor).toContain('SESSION="monitor-$$"');

    // Strengthen (review finding): a mutation that exits the loop on the first
    // failed drain must fail this test. The ONLY exit in the loop is the
    // parent-pid guard; the drain line must be unconditional (no `|| exit`,
    // no `&&`/`||` chaining an exit, and `set -e` must not be present, which
    // would abort the loop on a non-zero drain).
    const lines = monitor.split("\n");
    const drainLine = lines.find((l) => l.includes("inbox drain"));
    expect(drainLine).toBeDefined();
    expect(drainLine ?? "").not.toContain("exit");
    expect(drainLine ?? "").not.toContain("||");
    expect(monitor).not.toContain("set -e");
    // Exactly one `exit` (the parent-pid guard), and it is gated on kill -0.
    const exitLines = lines.filter((l) => l.includes("exit"));
    expect(exitLines.length).toBe(1);
    expect(exitLines[0] ?? "").toContain("kill -0");
  });

  it("the MCP identity env resolves to the same agent id as the hooks", () => {
    const cwd = join(home, "my-repo");
    const hookId = claudeAgentId(cwd);
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
    expect(existsSync(launcherPath(home))).toBe(false);
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

  it("rewrites a stale `npx` parley entry from an older install", () => {
    const stale = {
      mcpServers: { parley: { command: "npx", args: ["parley-mcp", "serve"] } },
    };
    writeFileSync(claudeJson(), `${JSON.stringify(stale, null, 2)}\n`, "utf8");

    installClaudeCode(env(), false, new FakeRunner());
    const servers = jsonObject.parse(readJson(claudeJson())["mcpServers"]);
    const entry = jsonObject.parse(servers["parley"]);
    expect(entry["command"]).toBe(launcherPath(home));
    expect(JSON.stringify(servers)).not.toContain("npx");
  });
});

describe("claude-code uninstall", () => {
  it("unregisters through the runner and removes exactly what install created", () => {
    installClaudeCode(env(), false, new FakeRunner());
    expect(existsSync(claudeJson())).toBe(true);
    expect(existsSync(launcherPath(home))).toBe(true);

    const runner = new FakeRunner();
    uninstallClaudeCode(env(), runner);
    expect(runner.sawSubcommand("plugin", "uninstall", "parley@parley")).toBe(true);
    expect(runner.sawSubcommand("plugin", "marketplace", "remove", "parley")).toBe(true);
    expect(existsSync(claudeJson())).toBe(false);
    expect(existsSync(join(home, MARKETPLACE_DIR_REL))).toBe(false);
    expect(existsSync(launcherPath(home))).toBe(false);
  });

  it("reports a non-zero `claude` uninstall step in the notes", () => {
    installClaudeCode(env(), false, new FakeRunner());
    const runner = new FakeRunner();
    runner.failOn = "uninstall";
    const report = uninstallClaudeCode(env(), runner);
    expect(report.notes?.some((n) => n.includes("uninstall failed"))).toBe(true);
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

  it("leaves a pre-existing unrelated file under ~/.mcp-parley intact", () => {
    mkdirSync(join(home, ".mcp-parley"), { recursive: true });
    const userFile = join(home, ".mcp-parley", "hub.db");
    writeFileSync(userFile, "db\n", "utf8");

    installClaudeCode(env(), false, new FakeRunner());
    uninstallClaudeCode(env(), new FakeRunner());

    expect(existsSync(userFile)).toBe(true);
    expect(existsSync(join(home, MARKETPLACE_DIR_REL))).toBe(false);
    // The launcher is gone, but the user's file (and therefore the data dir) survive.
    expect(existsSync(join(home, LAUNCHER_REL))).toBe(false);
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

    const empty = new FakeRunner();
    empty.listJson = "[]";
    expect(doctorClaudeCode(env(), empty).canWakeIdle).toBe(false);

    const ready = new FakeRunner();
    ready.listJson = JSON.stringify([{ name: "parley", enabled: true }]);
    expect(doctorClaudeCode(env(), ready).canWakeIdle).toBe(true);
  });

  it("reports cannot-wake-idle when the MCP command does not point at this install", () => {
    const ready = new FakeRunner();
    ready.listJson = JSON.stringify([{ name: "parley", enabled: true }]);
    installClaudeCode(env(), false, ready);
    // Simulate a stale `npx` command left in ~/.claude.json.
    const config = readJson(claudeJson());
    const servers = jsonObject.parse(config["mcpServers"]);
    servers["parley"] = { command: "npx", args: ["parley-mcp", "serve"] };
    writeFileSync(
      claudeJson(),
      `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`,
      "utf8",
    );
    const report = doctorClaudeCode(env(), ready);
    expect(report.canWakeIdle).toBe(false);
    expect(report.detail).toContain("does not point at this install");
  });

  it("reports cannot-wake-idle when the monitor script is missing", () => {
    const ready = new FakeRunner();
    ready.listJson = JSON.stringify([{ name: "parley", enabled: true }]);
    installClaudeCode(env(), false, ready);
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
