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
