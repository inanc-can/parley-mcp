import { dirname } from "node:path";
import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";

/**
 * User-level config helpers for adapters' `uninstall`. The rule (PLAN section 6
 * and the M3 review): remove **exactly** what install created, and remove a
 * directory **only if install created it and it is now empty**. Never a
 * recursive delete — a directory that still holds other files (anything the
 * user or another tool put there) must survive untouched.
 */

/** Delete a single file if it exists. Returns true when a file was removed. */
export function removeFileIfPresent(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path);
  return true;
}

/**
 * Remove a directory only if it exists and is now empty. A non-empty directory
 * (it holds files install did not create) is left exactly as it was. Never
 * recursive. Returns true when the directory was removed.
 */
export function removeDirIfEmpty(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  if (readdirSync(path).length > 0) {
    return false;
  }
  rmdirSync(path);
  return true;
}

/**
 * Remove `start` and then each parent directory while it is empty, stopping at
 * `stopAt` (never removed) or at the first directory that still holds anything.
 * Used to prune the launcher's bin/ and data dir after uninstall.
 */
export function pruneEmptyDirsUpTo(start: string, stopAt: string): void {
  let dir = start;
  while (dir !== stopAt && dir.startsWith(stopAt)) {
    if (!removeDirIfEmpty(dir)) {
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}
