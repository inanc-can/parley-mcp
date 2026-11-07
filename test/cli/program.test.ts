import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, type CliDeps } from "../../src/cli/index.js";

let home = "";

function deps(extra: Partial<CliDeps> = {}): { cli: CliDeps; lines: string[] } {
  const lines: string[] = [];
  const cli: CliDeps = {
    write: (line) => lines.push(line),
    env: { HOME: home, PARLEY_DB_PATH: join(home, "hub.db") },
    cwd: home,
    ...extra,
  };
  return { cli, lines };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "parley-prog-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("buildProgram setup --dry-run", () => {
  it("lists changes through commander and writes nothing to HOME", async () => {
    const { cli, lines } = deps();
    const program = buildProgram(cli);
    program.exitOverride();
    await program.parseAsync(["setup", "--dry-run"], { from: "user" });

    expect(lines.join("\n")).toContain("Dry run");
    // No files created under the temp HOME by a dry run.
    expect(readdirSync(home)).toEqual([]);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
  });
});

describe("buildProgram unknown --format", () => {
  it("rejects an unknown export format instead of silently defaulting", async () => {
    const { cli } = deps();
    const program = buildProgram(cli);
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });

    await expect(
      program.parseAsync(["export", "--format", "pdf"], { from: "user" }),
    ).rejects.toThrow();
  });

  it("rejects an unknown inbox drain format", async () => {
    const { cli } = deps();
    const program = buildProgram(cli);
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });

    await expect(
      program.parseAsync(["inbox", "drain", "--agent", "claude@x", "--format", "xml"], {
        from: "user",
      }),
    ).rejects.toThrow();
  });
});
