import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CLI_VERSION } from "../src/cli/index.js";
import { PARLEY_VERSION } from "../src/version.js";

describe("version", () => {
  it("is the same in package.json, the CLI and the code", () => {
    const pkg = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")));
    expect(PARLEY_VERSION).toBe(pkg.version);
    expect(CLI_VERSION).toBe(pkg.version);
  });
});
