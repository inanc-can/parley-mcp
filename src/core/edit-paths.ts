import { posix } from "node:path";

/**
 * Paths for claims and overlap (PLAN 4.5), made comparable across harnesses.
 * Claude Code and Cursor report absolute paths, Grok may report relative ones,
 * Codex's apply_patch reports none at all (the files are inside the patch),
 * and agents write claim globs relative to the repo. Everything is turned into
 * a repo-relative POSIX path before it is stored or matched. Pure: no I/O.
 * Windows paths are not handled in v1.
 */

/**
 * The files a Codex `apply_patch` touches. Its PostToolUse `tool_input` is
 * `{ "command": "<patch>" }` (verified in openai/codex
 * core/src/tools/handlers/apply_patch.rs, 2026-11-08); file names follow the
 * `*** Add File: `, `*** Delete File: `, `*** Update File: ` and
 * `*** Move to: ` markers (apply-patch/src/parser.rs), relative to the cwd.
 */
export function patchFilePaths(patch: string): string[] {
  const markers = ["*** Add File: ", "*** Delete File: ", "*** Update File: ", "*** Move to: "];
  const found: string[] = [];
  for (const raw of patch.split("\n")) {
    const line = raw.trim();
    const marker = markers.find((m) => line.startsWith(m));
    const name = marker === undefined ? "" : line.slice(marker.length).trim();
    if (name.length > 0 && !found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * The edited files named in a tool's input: `file_path` (Claude, Codex Edit /
 * Write, Cursor), `path` (some Grok tools), or the files inside an apply_patch
 * `command` / `input`.
 */
export function editedPathsFromToolInput(input: Record<string, unknown> | undefined): string[] {
  if (input === undefined) {
    return [];
  }
  for (const key of ["file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return [value];
    }
  }
  for (const key of ["command", "input", "patch"]) {
    const value = input[key];
    if (typeof value === "string" && value.includes("*** Begin Patch")) {
      return patchFilePaths(value);
    }
  }
  return [];
}

/**
 * `path` as a repo-relative POSIX path. A relative path is taken relative to
 * `cwd` (the agent's working folder). Returns null for a path outside the
 * repo: overlap is only tracked inside it.
 */
export function repoRelativePath(repoRoot: string, cwd: string, path: string): string | null {
  const absolute = posix.isAbsolute(path) ? posix.normalize(path) : posix.join(cwd, path);
  const relative = posix.relative(repoRoot, absolute);
  if (relative.length === 0 || relative === ".." || relative.startsWith("../") || posix.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

/**
 * A claim glob in the same form as stored edits: a leading `./` is dropped, an
 * absolute glob inside the repo becomes repo-relative, and a relative glob is
 * taken relative to `cwd` (the claiming agent's folder: for `claude@web`,
 * `src/**` means `web/src/**`). Without `cwd` a relative glob is already
 * repo-relative. Idempotent for stored globs (call it without `cwd`).
 */
export function normalizeClaimGlob(repoRoot: string, glob: string, cwd?: string): string {
  let out = glob.trim();
  while (out.startsWith("./")) {
    out = out.slice(2);
  }
  const root = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  if (out.startsWith(root)) {
    return out.slice(root.length);
  }
  if (posix.isAbsolute(out) || cwd === undefined) {
    return out;
  }
  const folder = posix.relative(repoRoot, cwd);
  if (folder.length === 0 || folder.startsWith("..")) {
    return out;
  }
  return posix.join(folder, out);
}
