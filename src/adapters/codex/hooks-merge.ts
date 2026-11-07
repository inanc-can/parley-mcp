import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { FileChange } from "../types.js";
import { hooksJsonText } from "./config-files.js";
import { OUR_LAUNCHER_SUFFIX } from "./toml-merge.js";

/**
 * Merge our lifecycle hooks into ~/.codex/hooks.json, preserving any hooks the
 * user already has (merge-not-overwrite, PLAN section 6). A handler is "ours"
 * when its command invokes an mcp-parley launcher; uninstall removes exactly
 * those, and deletes the file only when nothing of the user's is left.
 */

const hookHandlerSchema = z.looseObject({
  type: z.string().optional(),
  command: z.string().optional(),
  timeout: z.number().optional(),
});
const hookGroupSchema = z.looseObject({
  matcher: z.string().optional(),
  hooks: z.array(hookHandlerSchema),
});
const hooksFileSchema = z.looseObject({
  description: z.string().optional(),
  hooks: z.record(z.string(), z.array(hookGroupSchema)).optional(),
});

type HooksFile = z.infer<typeof hooksFileSchema>;
type HookGroup = z.infer<typeof hookGroupSchema>;

function isOurHandler(handler: { command?: string | undefined }): boolean {
  return handler.command?.includes(OUR_LAUNCHER_SUFFIX) ?? false;
}

function isOurGroup(group: HookGroup): boolean {
  return group.hooks.some(isOurHandler);
}

function readHooksFile(path: string): HooksFile {
  if (!existsSync(path)) {
    return {};
  }
  return hooksFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** True when hooks.json already contains at least one mcp-parley handler. */
export function hooksFileHasOurs(path: string): boolean {
  return objectHasOurs(readHooksFile(path));
}

function objectHasOurs(file: HooksFile): boolean {
  return Object.values(file.hooks ?? {}).some((groups) => groups.some(isOurGroup));
}

/** The user's groups per event with OUR groups filtered out. */
function withoutOurGroups(file: HooksFile): Record<string, HookGroup[]> {
  const events: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(file.hooks ?? {})) {
    const kept = groups.filter((g) => !isOurGroup(g));
    if (kept.length > 0) {
      events[event] = kept;
    }
  }
  return events;
}

function ourHooksFile(launcher: string): HooksFile {
  return hooksFileSchema.parse(JSON.parse(hooksJsonText(launcher)));
}

/**
 * The merged hooks.json text: the user's non-ours groups, plus our groups added
 * back. Idempotent (our groups are replaced, not duplicated).
 */
function mergedHooksText(existing: HooksFile, launcher: string): string {
  const ourFile = ourHooksFile(launcher);
  const events: Record<string, HookGroup[]> = withoutOurGroups(existing);
  for (const [event, groups] of Object.entries(ourFile.hooks ?? {})) {
    events[event] = [...(events[event] ?? []), ...groups];
  }
  const out: Record<string, unknown> = {};
  if (existing.description !== undefined) {
    out["description"] = existing.description;
  } else if (Object.keys(existing.hooks ?? {}).length === 0) {
    out["description"] = ourFile.description;
  }
  out["hooks"] = events;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function planHooksChange(path: string, launcher: string): FileChange | null {
  const next = mergedHooksText(readHooksFile(path), launcher);
  if (existsSync(path) && readFileSync(path, "utf8") === next) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

export function writeHooksJson(path: string, launcher: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, mergedHooksText(readHooksFile(path), launcher), "utf8");
}

/**
 * Remove our groups from hooks.json. Delete the file (and prune the dir) when
 * nothing of the user's remains; else rewrite with only their groups. Returns
 * the change, or null when nothing was ours.
 */
export function removeOurHooks(path: string): FileChange | null {
  const existing = readHooksFile(path);
  if (!objectHasOurs(existing)) {
    return null;
  }
  const events = withoutOurGroups(existing);
  if (Object.keys(events).length === 0) {
    removeFileIfPresent(path);
    removeDirIfEmpty(dirname(path));
    return { path, action: "create" };
  }
  const out: Record<string, unknown> = {};
  if (existing.description !== undefined) {
    out["description"] = existing.description;
  }
  out["hooks"] = events;
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  return { path, action: "merge" };
}
