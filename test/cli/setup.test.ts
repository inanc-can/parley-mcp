import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AdapterEnv } from "../../src/adapters/index.js";
import { fakeAdapter } from "../../src/adapters/fake/index.js";
import { runSetup } from "../../src/cli/commands/setup.js";
import { runUninstall } from "../../src/cli/commands/uninstall.js";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const CONFIG_REL = join(".parley-fake", "config.json");

const FAKES = [fakeAdapter];

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
    await runSetup({ env: env(), write: out.write, dryRun: true, adapters: FAKES });
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
    await runSetup({ env: env(), write: first.write, adapters: FAKES });
    expect(existsSync(configFile())).toBe(true);
    const afterFirst = readFileSync(configFile(), "utf8");
    expect(first.lines.join("\n")).toContain("did create");

    const second = collector();
    await runSetup({ env: env(), write: second.write, adapters: FAKES });
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
    await runSetup({ env: env(), write: () => undefined, adapters: FAKES });
    expect(existsSync(configFile())).toBe(true);

    const out = collector();
    await runUninstall({ env: env(), write: out.write, adapters: FAKES });
    // After uninstall the tree is exactly as before: the file is gone.
    expect(existsSync(configFile())).toBe(false);
    expect(out.lines.join("\n")).toContain("removed");
  });

  it("merges into an existing file and restores it byte for byte", async () => {
    // A pre-existing user file with unrelated keys.
    const original = `${JSON.stringify({ editor: { theme: "dark" } }, null, 2)}\n`;
    mkdirSync(dirname(configFile()), { recursive: true });
    writeFileSync(configFile(), original, "utf8");

    await runSetup({ env: env(), write: () => undefined, adapters: FAKES });
    const merged = readFileSync(configFile(), "utf8");
    expect(merged).toContain("parley");
    expect(merged).toContain("editor");

    await runUninstall({ env: env(), write: () => undefined, adapters: FAKES });
    const restored = readFileSync(configFile(), "utf8");
    // The unrelated keys are preserved exactly; only our key is removed.
    expect(restored).toBe(original);
  });

  it("leaves a pre-existing unrelated file in the config's parent dir intact", async () => {
    // The fake adapter created the config, but the .parley-fake dir also holds
    // an unrelated file the user put there. Uninstall must remove only our file
    // and must NOT recursively delete the directory (the M3 review must-fix).
    const sibling = join(dirname(configFile()), "notes.txt");
    mkdirSync(dirname(configFile()), { recursive: true });
    writeFileSync(sibling, "user data", "utf8");

    await runSetup({ env: env(), write: () => undefined, adapters: FAKES });
    expect(existsSync(configFile())).toBe(true);

    await runUninstall({ env: env(), write: () => undefined, adapters: FAKES });
    // Our config is gone, but the sibling file and its directory survive.
    expect(existsSync(configFile())).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(readFileSync(sibling, "utf8")).toBe("user data");
  });
});

describe("doctor", () => {
  it("reports readiness before and after setup", async () => {
    const before = collector();
    await runDoctor({ env: env(), write: before.write, adapters: FAKES });
    expect(before.lines.join("\n")).toContain("cannot wake idle");

    await runSetup({ env: env(), write: () => undefined, adapters: FAKES });
    const after = collector();
    await runDoctor({ env: env(), write: after.write, adapters: FAKES });
    expect(after.lines.join("\n")).toContain("can wake idle");
  });
});

describe("setup from npx's cache", () => {
  it("refuses, because npm may delete the cache the configs would point at", async () => {
    const { runningFromNpxCache, NPX_REFUSAL } = await import("../../src/cli/commands/setup.js");
    expect(runningFromNpxCache("/Users/a/.npm/_npx/1a2b3c/node_modules/mcp-parley/dist/cli/bin.js")).toBe(true);
    expect(runningFromNpxCache("C:\\Users\\a\\AppData\\npm-cache\\_npx\\1a2b\\node_modules\\mcp-parley\\dist\\cli\\bin.js")).toBe(true);
    expect(runningFromNpxCache("/usr/local/lib/node_modules/mcp-parley/dist/cli/bin.js")).toBe(false);
    const out = collector();
    await runSetup({ env: env(), write: out.write, adapters: FAKES, entryPath: "/h/.npm/_npx/9/node_modules/mcp-parley/dist/cli/bin.js" });
    expect(out.lines).toEqual(NPX_REFUSAL);
    // A dry run is harmless, so it still runs.
    const dry = collector();
    await runSetup({ env: env(), write: dry.write, adapters: FAKES, dryRun: true, entryPath: "/h/.npm/_npx/9/x.js" });
    expect(dry.lines[0]).toContain("Dry run");
  });
});
