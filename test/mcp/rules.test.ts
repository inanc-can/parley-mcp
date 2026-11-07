import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRulesFile, rulesReminder } from "../../src/mcp/rules.js";

describe("rulesReminder", () => {
  it("is null when there is no rules file", () => {
    expect(rulesReminder({ exists: false, text: null })).toBeNull();
  });

  it("reminds agents that a rules file exists", () => {
    expect(
      rulesReminder({ exists: true, text: "be kind" }),
    ).toBe(
      "This repo has a .parley/rules.md rules file for agents; see your inbox for its text.",
    );
  });
});

describe("readRulesFile", () => {
  it("reports no rules file when .parley/rules.md is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parley-rules-"));
    try {
      expect(readRulesFile(dir)).toEqual({ exists: false, text: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the rules text when .parley/rules.md exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parley-rules-"));
    try {
      mkdirSync(join(dir, ".parley"), { recursive: true });
      writeFileSync(join(dir, ".parley", "rules.md"), "be kind and review");
      expect(readRulesFile(dir)).toEqual({
        exists: true,
        text: "be kind and review",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
