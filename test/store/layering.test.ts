import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layering invariant (AGENTS.md): layers point one way — `cli` / `mcp` /
 * `adapters` / `viewer` → `core` → `store`. The store must never import core
 * logic; to keep the arrow one way, composition of store I/O with core
 * decisions lives in `src/mcp/guards.ts` instead.
 */

const STORE_DIR = fileURLToPath(new URL("../../src/store", import.meta.url));

function listFilesRecursively(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFilesRecursively(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("store layer never imports core", () => {
  it("has no src/core imports anywhere under src/store", () => {
    const offenders: string[] = [];
    for (const file of listFilesRecursively(STORE_DIR)) {
      const text = readFileSync(file, "utf8");
      // Matches relative module specifiers that reach src/core from src/store.
      const matches = text.match(/from\s+"[^"]*\/core\/[^"]*"/g) ?? [];
      if (matches.length > 0) {
        offenders.push(`${file}: ${JSON.stringify(matches)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
