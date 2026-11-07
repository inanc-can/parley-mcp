import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * End-to-end build smoke test: compile the project the way the real install
 * does (`tsc -p tsconfig.build.json`) into a throwaway outDir, then run the
 * compiled CLI under plain Node — the same runtime the installed launcher uses.
 *
 * This catches failures the in-process Vitest run hides: extensionless deep
 * imports, emit/rootDir mistakes, or a bin entry that cannot start under plain
 * Node. It complements `build-imports.test.ts` (a static regex guard) with an
 * actual compile + run.
 *
 * It skips cleanly when the build tool is unavailable (e.g. node_modules not
 * installed in a constrained CI lane) rather than failing.
 */

/** The local TypeScript compiler, or null when it is not installed. */
function findTsc(): string | null {
  const bin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  return existsSync(bin) ? bin : null;
}

describe("compiled CLI smoke test", () => {
  it("builds with tsconfig.build.json and runs `cli/bin.js --help` under plain Node", () => {
    const tsc = findTsc();
    if (tsc === null) {
      // Build tool unavailable: skip cleanly (acceptance allows this).
      return;
    }

    // Build inside the project's already-ignored `dist/` so Node resolves the
    // runtime deps (commander, the SDK, …) from the project's node_modules by
    // walking up, exactly as the real `dist/cli/bin.js` does. A random suffix
    // keeps it from colliding with a real `pnpm build`, and `finally` removes it.
    const distRoot = join(process.cwd(), "dist");
    mkdirSync(distRoot, { recursive: true });
    const outDir = mkdtempSync(join(distRoot, "smoke-"));
    try {
      // Compile the real build config into the temp outDir.
      execFileSync(tsc, ["-p", "tsconfig.build.json", "--outDir", outDir], {
        cwd: process.cwd(),
        stdio: "pipe",
      });

      const binJs = join(outDir, "cli", "bin.js");
      expect(existsSync(binJs)).toBe(true);

      // Run the compiled CLI under plain Node (what the installed launcher does).
      const help = execFileSync(process.execPath, [binJs, "--help"], {
        cwd: process.cwd(),
        stdio: "pipe",
        encoding: "utf8",
      });
      // `--help` prints the program usage and exits 0.
      expect(help).toContain("mcp-parley");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
