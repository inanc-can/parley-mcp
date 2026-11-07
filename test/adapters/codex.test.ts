import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
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
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AdapterEnv } from "../../src/adapters/index.js";
import { doctorCodex, installCodex, uninstallCodex } from "../../src/adapters/codex/install.js";
import {
  CONFIG_TOML_REL,
  HOOKS_JSON_REL,
  MCP_SERVER_KEY,
} from "../../src/adapters/codex/config-files.js";
import { launcherPath } from "../../src/adapters/cli-path.js";

let home = "";

function env(): AdapterEnv {
  return { home };
}

function configToml(): string {
  return join(home, CONFIG_TOML_REL);
}

function hooksJson(): string {
  return join(home, HOOKS_JSON_REL);
}

const tomlObject = z.record(z.string(), z.unknown());

function readMcpServers(): Record<string, unknown> {
  const parsed = parseToml(readFileSync(configToml(), "utf8"));
  const top = tomlObject.parse(parsed);
  return tomlObject.parse(top["mcp_servers"]);
}

/** Every generated file's text, so we can assert none of them contain `npx`. */
function allGeneratedText(): string[] {
  const texts: string[] = [];
  const codexDir = join(home, ".codex");
  if (existsSync(codexDir)) {
    for (const name of readdirSync(codexDir)) {
      const full = join(codexDir, name);
      if (statSync(full).isFile()) {
        texts.push(readFileSync(full, "utf8"));
      }
    }
  }
  if (existsSync(launcherPath(home))) {
    texts.push(readFileSync(launcherPath(home), "utf8"));
  }
  return texts;
}

/** doctor with the app-server probe stubbed so tests never spawn `codex`. */
function doctorReachable(reachable: boolean) {
  return doctorCodex(env(), () => reachable);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-codex-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("codex install", () => {
  it("writes the launcher, the config.toml MCP entry pointing at it, and hooks.json", () => {
    installCodex(env(), false);

    const launcher = launcherPath(home);
    expect(existsSync(launcher)).toBe(true);

    const servers = readMcpServers();
    const entry = tomlObject.parse(servers[MCP_SERVER_KEY]);
    expect(entry["command"]).toBe(launcher);
    expect(entry["args"]).toEqual(["serve"]);
    expect(tomlObject.parse(entry["env"])["PARLEY_HARNESS"]).toBe("codex");

    expect(existsSync(hooksJson())).toBe(true);
    const hooks = z
      .looseObject({ hooks: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(readFileSync(hooksJson(), "utf8")));
    expect(Object.keys(hooks.hooks).sort()).toEqual(
      ["PostToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("generates NO file that runs npx (the security finding)", () => {
    installCodex(env(), false);
    for (const text of allGeneratedText()) {
      expect(text).not.toContain("npx");
    }
    // Positive: the launcher is referenced in hooks.json and the config entry.
    const launcher = launcherPath(home);
    expect(readFileSync(hooksJson(), "utf8")).toContain(launcher);
    expect(readFileSync(configToml(), "utf8")).toContain(launcher);
  });

  it("tells the human to trust the hooks via /hooks", () => {
    const report = installCodex(env(), false);
    expect((report.notes ?? []).join("\n")).toContain("/hooks");
  });

  it("is a no-op on a second run (byte for byte)", () => {
    installCodex(env(), false);
    const firstConfig = readFileSync(configToml(), "utf8");
    const firstHooks = readFileSync(hooksJson(), "utf8");

    const report = installCodex(env(), false);
    expect(report.changes).toEqual([]);
    expect(readFileSync(configToml(), "utf8")).toBe(firstConfig);
    expect(readFileSync(hooksJson(), "utf8")).toBe(firstHooks);
  });

  it("dry-run writes nothing", () => {
    const report = installCodex(env(), true);
    expect(report.dryRun).toBe(true);
    expect(report.changes.length).toBeGreaterThan(0);
    expect(existsSync(configToml())).toBe(false);
    expect(existsSync(hooksJson())).toBe(false);
    expect(existsSync(launcherPath(home))).toBe(false);
  });
});

describe("codex install merges into an existing config.toml", () => {
  const PRIOR = [
    "# my codex config",
    'model = "gpt-5-codex"',
    "",
    "[mcp_servers.other]",
    'command = "/usr/bin/other"',
    'args = ["serve"]',
    "",
    "[tui]",
    "theme = \"dark\"",
    "",
  ].join("\n");

  beforeEach(() => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), PRIOR, "utf8");
  });

  it("keeps comments, other tables and other mcp_servers, and adds ours", () => {
    installCodex(env(), false);
    const text = readFileSync(configToml(), "utf8");
    expect(text).toContain("# my codex config");
    expect(text).toContain("[tui]");
    expect(text).toContain('theme = "dark"');

    const servers = readMcpServers();
    expect(tomlObject.parse(servers["other"])["command"]).toBe("/usr/bin/other");
    expect(tomlObject.parse(servers[MCP_SERVER_KEY])["command"]).toBe(launcherPath(home));
  });

  it("uninstall restores config.toml byte for byte", () => {
    installCodex(env(), false);
    uninstallCodex(env());
    expect(readFileSync(configToml(), "utf8")).toBe(PRIOR);
  });
});

describe("codex foreign entry guard", () => {
  it("never overwrites or removes an `mcp-parley` entry it did not create", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const foreign = [
      "[mcp_servers.mcp-parley]",
      'command = "npx"',
      'args = ["mcp-parley", "serve"]',
      "",
    ].join("\n");
    writeFileSync(configToml(), foreign, "utf8");

    const report = installCodex(env(), false);
    expect(readFileSync(configToml(), "utf8")).toBe(foreign);
    expect((report.notes ?? []).join("\n")).toContain("did not create");

    uninstallCodex(env());
    expect(readFileSync(configToml(), "utf8")).toBe(foreign);
  });
});

describe("codex uninstall", () => {
  it("removes exactly what install created when config.toml held only our block", () => {
    installCodex(env(), false);
    expect(existsSync(configToml())).toBe(true);
    expect(existsSync(hooksJson())).toBe(true);
    expect(existsSync(launcherPath(home))).toBe(true);

    uninstallCodex(env());
    // config.toml existed only for our block -> removed; hooks + launcher gone.
    expect(existsSync(configToml())).toBe(false);
    expect(existsSync(hooksJson())).toBe(false);
    expect(existsSync(launcherPath(home))).toBe(false);
  });

  it("merges into a pre-existing foreign hooks.json and restores it on uninstall", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const foreignHooks = `${JSON.stringify(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: "/usr/bin/their-stop" }] }] } },
      null,
      2,
    )}\n`;
    writeFileSync(hooksJson(), foreignHooks, "utf8");

    installCodex(env(), false);
    const merged = readFileSync(hooksJson(), "utf8");
    // The user's Stop handler survives alongside ours.
    expect(merged).toContain("/usr/bin/their-stop");
    expect(merged).toContain(launcherPath(home));

    uninstallCodex(env());
    // Only our groups are removed; the user's file is restored byte for byte.
    expect(readFileSync(hooksJson(), "utf8")).toBe(foreignHooks);
  });
});

describe("codex doctor", () => {
  it("reports not-wired before setup", () => {
    const before = doctorReachable(true);
    expect(before.canWakeIdle).toBe(false);
    expect(before.hooksTrusted).toBeNull();
    expect(before.detail).toContain("run setup");
  });

  it("reports can-wake-idle only when wired, hooks present and app-server reachable", () => {
    installCodex(env(), false);
    expect(doctorReachable(true).canWakeIdle).toBe(true);
    // App-server unreachable -> idle wake falls back to queue, so not can-wake-idle.
    const offline = doctorReachable(false);
    expect(offline.canWakeIdle).toBe(false);
    expect(offline.detail).toContain("app-server not reachable");
  });

  it("never claims hooks are trusted (unknown until /hooks)", () => {
    installCodex(env(), false);
    const report = doctorReachable(true);
    expect(report.hooksTrusted).toBeNull();
    expect(report.detail).toContain("/hooks");
  });

  it("reports cannot-wake-idle when the config command points elsewhere", () => {
    installCodex(env(), false);
    // Rewrite our entry's command to a different install's launcher.
    const text = readFileSync(configToml(), "utf8").replace(
      launcherPath(home),
      "/somewhere/else/.mcp-parley/bin/mcp-parley",
    );
    writeFileSync(configToml(), text, "utf8");
    const report = doctorReachable(true);
    expect(report.canWakeIdle).toBe(false);
    expect(report.detail).toContain("does not point at this install");
  });
});

describe("codex detect", () => {
  it("reports not installed on a clean HOME and installed when ~/.codex exists", async () => {
    const { codexAdapter } = await import("../../src/adapters/codex/index.js");
    expect((await codexAdapter.detect(env())).installed).toBe(false);
    mkdirSync(join(home, ".codex"), { recursive: true });
    expect((await codexAdapter.detect(env())).installed).toBe(true);
  });
});
