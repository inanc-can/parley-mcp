import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AdapterEnv } from "../../src/adapters/index.js";
import { runSetup } from "../../src/cli/commands/setup.js";
import { runUninstall } from "../../src/cli/commands/uninstall.js";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const CONFIG_REL = join(".parley-fake", "config.json");

let home = "";

function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function configFile(): string {
  return join(home, CONFIG_REL);
}

function env(): AdapterEnv {
  return { home };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-home-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("setup --dry-run", () => {
  it("lists the changes and writes nothing", async () => {
    const out = collector();
    await runSetup({ env: env(), write: out.write, dryRun: true });
    const text = out.lines.join("\n");
    expect(text).toContain("Dry run");
    expect(text).toContain("would create");
    expect(text).toContain(CONFIG_REL);
    // Nothing was written.
    expect(existsSync(configFile())).toBe(false);
  });
});

describe("setup idempotency", () => {
  it("creates the config on the first run and changes nothing on the second", async () => {
    const first = collector();
    await runSetup({ env: env(), write: first.write });
    expect(existsSync(configFile())).toBe(true);
    const afterFirst = readFileSync(configFile(), "utf8");
    expect(first.lines.join("\n")).toContain("did create");

    const second = collector();
    await runSetup({ env: env(), write: second.write });
    const afterSecond = readFileSync(configFile(), "utf8");
    // Byte-for-byte identical after the second run.
    expect(afterSecond).toBe(afterFirst);
    expect(second.lines.join("\n")).toContain("already set up");
  });
});

describe("uninstall", () => {
  it("restores a created file byte for byte (removes it entirely)", async () => {
    // Before: no file exists.
    expect(existsSync(configFile())).toBe(false);
    await runSetup({ env: env(), write: () => undefined });
    expect(existsSync(configFile())).toBe(true);

    const out = collector();
    await runUninstall({ env: env(), write: out.write });
    // After uninstall the tree is exactly as before: the file is gone.
    expect(existsSync(configFile())).toBe(false);
    expect(out.lines.join("\n")).toContain("removed");
  });

  it("merges into an existing file and restores it byte for byte", async () => {
    // A pre-existing user file with unrelated keys.
    const original = `${JSON.stringify({ editor: { theme: "dark" } }, null, 2)}\n`;
    mkdirSync(dirname(configFile()), { recursive: true });
    writeFileSync(configFile(), original, "utf8");

    await runSetup({ env: env(), write: () => undefined });
    const merged = readFileSync(configFile(), "utf8");
    expect(merged).toContain("parley");
    expect(merged).toContain("editor");

    await runUninstall({ env: env(), write: () => undefined });
    const restored = readFileSync(configFile(), "utf8");
    // The unrelated keys are preserved exactly; only our key is removed.
    expect(restored).toBe(original);
  });
});

describe("doctor", () => {
  it("reports readiness before and after setup", async () => {
    const before = collector();
    await runDoctor({ env: env(), write: before.write });
    expect(before.lines.join("\n")).toContain("cannot wake idle");

    await runSetup({ env: env(), write: () => undefined });
    const after = collector();
    await runDoctor({ env: env(), write: after.write });
    expect(after.lines.join("\n")).toContain("can wake idle");
  });
});
