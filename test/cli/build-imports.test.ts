import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The installed launcher runs the compiled CLI (dist/) under plain Node, which,
 * unlike Vitest, does not resolve extensionless deep imports. A bare subpath
 * import such as "@modelcontextprotocol/sdk/server/mcp" passes every test but
 * crashes the real `mcp-parley serve`. Guard every source file against it.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const DEEP_IMPORT = /from\s+"((?:@[^/"]+\/)?[^/".][^/"]*\/[^"]+)"/g;

describe("compiled-runtime imports", () => {
  it("every deep package import in src ends in .js so plain Node can resolve it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(DEEP_IMPORT)) {
        const specifier = match[1] ?? "";
        if (!specifier.endsWith(".js")) offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
