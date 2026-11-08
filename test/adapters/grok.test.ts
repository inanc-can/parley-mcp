import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { launcherPath } from "../../src/adapters/cli-path.js";
import { grokAdapter } from "../../src/adapters/grok/index.js";
import { doctorGrok, installGrok, uninstallGrok } from "../../src/adapters/grok/install.js";

let home = "";
const env = () => ({ home });
const configToml = () => join(home, ".grok", "config.toml");
const hooksFile = () => join(home, ".grok", "hooks", "mcp-parley.json");
const skillFile = () => join(home, ".grok", "skills", "mcp-parley", "SKILL.md");

const tomlSchema = z.looseObject({
  mcp_servers: z.record(z.string(), z.looseObject({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) })),
});
const hooksSchema = z.object({
  hooks: z.record(z.string(), z.array(z.object({ hooks: z.array(z.looseObject({ type: z.string(), command: z.string() })) }))),
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-grok-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("grok install", () => {
  it("registers the MCP server as grok and writes our hooks file and skill", () => {
    installGrok(env(), false);
    const server = tomlSchema.parse(parseToml(readFileSync(configToml(), "utf8"))).mcp_servers["mcp-parley"];
    expect(server).toEqual({ command: launcherPath(home), args: ["serve"], env: { PARLEY_HARNESS: "grok" } });
    const hooks = hooksSchema.parse(JSON.parse(readFileSync(hooksFile(), "utf8")));
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PostToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(hooks.hooks["Stop"]?.[0]?.hooks[0]?.command).toBe(`"${launcherPath(home)}" hook grok-stop`);
    const skill = readFileSync(skillFile(), "utf8");
    expect(skill).toMatch(/^---\nname: mcp-parley\n/);
    expect(skill).toContain(`"${launcherPath(home)}" inbox watch --agent grok@<folder> --provider grok`);
    for (const file of [configToml(), hooksFile(), skillFile()]) {
      expect(readFileSync(file, "utf8")).not.toContain("npx");
    }
  });

  it("is idempotent and a dry run writes nothing", () => {
    expect(installGrok(env(), true).changes.length).toBeGreaterThan(0);
    expect(existsSync(join(home, ".grok"))).toBe(false);
    installGrok(env(), false);
    expect(installGrok(env(), false).changes).toEqual([]);
  });

  it("keeps the user's config.toml and gives it back byte for byte on uninstall", () => {
    mkdirSync(join(home, ".grok"));
    const original = '# my grok settings\n[models]\ndefault = "grok-code"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n';
    writeFileSync(configToml(), original);
    installGrok(env(), false);
    const text = readFileSync(configToml(), "utf8");
    expect(text.startsWith(original)).toBe(true);
    expect(text).toContain('PARLEY_HARNESS = "grok"');
    uninstallGrok(env());
    expect(readFileSync(configToml(), "utf8")).toBe(original);
    expect(existsSync(hooksFile())).toBe(false);
    expect(existsSync(skillFile())).toBe(false);
    expect(existsSync(launcherPath(home))).toBe(false);
  });

  it("removes everything it created when nothing else was there", () => {
    installGrok(env(), false);
    uninstallGrok(env());
    expect(existsSync(join(home, ".grok"))).toBe(false);
    expect(existsSync(join(home, ".mcp-parley"))).toBe(false);
  });

  it("never touches a foreign mcp-parley server, hooks file or skill", () => {
    mkdirSync(join(home, ".grok", "hooks"), { recursive: true });
    const foreignToml = '[mcp_servers.mcp-parley]\ncommand = "/opt/other"\n';
    const foreignHooks = '{ "hooks": {} }\n';
    writeFileSync(configToml(), foreignToml);
    writeFileSync(hooksFile(), foreignHooks);
    const report = installGrok(env(), false);
    expect(report.notes?.filter((n) => n.includes("untouched"))).toHaveLength(2);
    expect(readFileSync(configToml(), "utf8")).toBe(foreignToml);
    expect(readFileSync(hooksFile(), "utf8")).toBe(foreignHooks);
    uninstallGrok(env());
    expect(readFileSync(configToml(), "utf8")).toBe(foreignToml);
    expect(readFileSync(hooksFile(), "utf8")).toBe(foreignHooks);
  });
});

describe("grok doctor and detect", () => {
  it("reports not wired, then can-wake-idle with trust not applicable", () => {
    expect(doctorGrok(env())).toMatchObject({ installed: false, canWakeIdle: false, hooksTrusted: null });
    installGrok(env(), false);
    const report = doctorGrok(env());
    expect(report).toMatchObject({ installed: true, canWakeIdle: true, hooksTrusted: null });
    expect(report.detail).toContain("persistent monitor");
    rmSync(skillFile());
    expect(doctorGrok(env()).detail).toContain("SKILL.md missing");
  });

  it("detects Grok by ~/.grok", async () => {
    expect((await grokAdapter.detect(env())).installed).toBe(false);
    mkdirSync(join(home, ".grok"));
    expect((await grokAdapter.detect(env())).installed).toBe(true);
  });
});
