import { describe, expect, it } from "vitest";
import {
  editedPathsFromToolInput,
  normalizeClaimGlob,
  patchFilePaths,
  repoRelativePath,
} from "../../src/core/edit-paths.js";

const PATCH = [
  "*** Begin Patch",
  "*** Update File: src/server.ts",
  "@@",
  "-a",
  "+b",
  "*** Update File: src/old-name.ts",
  "*** Move to: src/new-name.ts",
  "*** Add File: src/routes/health.ts",
  "+export {};",
  "*** Delete File: src/dead.ts",
  "*** Update File: src/server.ts",
  "*** End Patch",
].join("\n");

describe("patchFilePaths", () => {
  it("lists every file an apply_patch touches, once each, in order", () => {
    expect(patchFilePaths(PATCH)).toEqual([
      "src/server.ts",
      "src/old-name.ts",
      "src/new-name.ts",
      "src/routes/health.ts",
      "src/dead.ts",
    ]);
    expect(patchFilePaths("no patch here")).toEqual([]);
  });
});

describe("editedPathsFromToolInput", () => {
  it("reads file_path, path, or the files inside a patch", () => {
    expect(editedPathsFromToolInput({ file_path: "/r/a.ts" })).toEqual(["/r/a.ts"]);
    expect(editedPathsFromToolInput({ path: "b.ts" })).toEqual(["b.ts"]);
    expect(editedPathsFromToolInput({ command: PATCH })).toHaveLength(5);
    expect(editedPathsFromToolInput({ command: "ls -la" })).toEqual([]);
    expect(editedPathsFromToolInput(undefined)).toEqual([]);
  });
});

describe("repoRelativePath", () => {
  it("makes absolute and cwd-relative paths repo-relative", () => {
    expect(repoRelativePath("/repo", "/repo/web", "/repo/web/src/a.ts")).toBe("web/src/a.ts");
    expect(repoRelativePath("/repo", "/repo/web", "src/a.ts")).toBe("web/src/a.ts");
    expect(repoRelativePath("/repo", "/repo/web", "../api/b.ts")).toBe("api/b.ts");
    expect(repoRelativePath("/repo", "/repo", "./x/../y.ts")).toBe("y.ts");
  });

  it("returns null outside the repo", () => {
    expect(repoRelativePath("/repo", "/repo/web", "/etc/passwd")).toBeNull();
    expect(repoRelativePath("/repo", "/repo", "../other/a.ts")).toBeNull();
    expect(repoRelativePath("/repo", "/repo", "/repo")).toBeNull();
    expect(repoRelativePath("/repo", "/repo", "/repository/a.ts")).toBeNull();
  });
});

describe("normalizeClaimGlob", () => {
  it("resolves a relative glob against the claiming agent's folder", () => {
    expect(normalizeClaimGlob("/repo", "src/auth/**", "/repo/web")).toBe("web/src/auth/**");
    expect(normalizeClaimGlob("/repo", "./src/**", "/repo/web")).toBe("web/src/**");
    expect(normalizeClaimGlob("/repo", "src/**", "/repo")).toBe("src/**");
  });

  it("makes an absolute glob inside the repo relative, and is idempotent without cwd", () => {
    expect(normalizeClaimGlob("/repo", "/repo/web/src/**", "/repo/api")).toBe("web/src/**");
    expect(normalizeClaimGlob("/repo", "web/src/**")).toBe("web/src/**");
    expect(normalizeClaimGlob("/repo", "/elsewhere/**", "/repo/web")).toBe("/elsewhere/**");
  });
});
