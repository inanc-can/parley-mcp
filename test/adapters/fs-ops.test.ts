import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDirIfEmpty, removeFileIfPresent } from "../../src/adapters/fs-ops.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "parley-fsops-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("removeFileIfPresent", () => {
  it("removes an existing file and reports it", () => {
    const file = join(root, "a.txt");
    writeFileSync(file, "x", "utf8");
    expect(removeFileIfPresent(file)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("is a no-op for a missing file", () => {
    expect(removeFileIfPresent(join(root, "missing.txt"))).toBe(false);
  });
});

describe("removeDirIfEmpty", () => {
  it("removes an empty directory", () => {
    const dir = join(root, "empty");
    mkdirSync(dir);
    expect(removeDirIfEmpty(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("leaves a non-empty directory and its contents untouched", () => {
    const dir = join(root, "full");
    mkdirSync(dir);
    const keep = join(dir, "keep.txt");
    writeFileSync(keep, "survive", "utf8");
    expect(removeDirIfEmpty(dir)).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(keep)).toBe(true);
  });

  it("is a no-op for a missing directory", () => {
    expect(removeDirIfEmpty(join(root, "missing"))).toBe(false);
  });
});
