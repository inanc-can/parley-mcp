import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { FileChange } from "../types.js";
import { CURSOR_HOOKS, MCP_SERVER_KEY, hookEntry, mcpServerEntry } from "./config-files.js";

/**
 * Merge-not-overwrite edits of ~/.cursor/mcp.json and ~/.cursor/hooks.json.
 * Everything that is not ours is kept as it was; uninstall removes only our
 * entries, and deletes a file only when nothing of the user's remains. An
 * entry is ours when its command runs an mcp-parley launcher.
 */

export const OUR_LAUNCHER_SUFFIX = "/.mcp-parley/bin/mcp-parley";

const objectSchema = z.record(z.string(), z.unknown());
const commandSchema = z.looseObject({ command: z.string() });
const listSchema = z.array(z.unknown());

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, "utf8").trim();
  return text.length === 0 ? {} : objectSchema.parse(JSON.parse(text));
}

function writeJson(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asObject(value: unknown): Record<string, unknown> {
  const parsed = objectSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function isOurs(entry: unknown): boolean {
  const parsed = commandSchema.safeParse(entry);
  return parsed.success && parsed.data.command.includes(OUR_LAUNCHER_SUFFIX);
}

// ---- mcp.json ---------------------------------------------------------------

function servers(path: string): Record<string, unknown> {
  return asObject(readJson(path)["mcpServers"]);
}

export function mcpEntryPresent(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(servers(path), MCP_SERVER_KEY);
}

/** An `mcp-parley` entry that another tool (not mcp-parley setup) wrote. */
export function foreignMcpEntry(path: string): boolean {
  return mcpEntryPresent(path) && !isOurs(servers(path)[MCP_SERVER_KEY]);
}

export function mcpPointsAt(path: string, launcher: string): boolean {
  const parsed = commandSchema.safeParse(servers(path)[MCP_SERVER_KEY]);
  return parsed.success && parsed.data.command === launcher;
}

export function planMcpChange(path: string, launcher: string): FileChange | null {
  const current = servers(path)[MCP_SERVER_KEY];
  if (JSON.stringify(current) === JSON.stringify(mcpServerEntry(launcher))) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

export function writeMcpEntry(path: string, launcher: string): void {
  const config = readJson(path);
  config["mcpServers"] = { ...asObject(config["mcpServers"]), [MCP_SERVER_KEY]: mcpServerEntry(launcher) };
  writeJson(path, config);
}

export function removeMcpEntry(path: string): FileChange | null {
  if (!existsSync(path)) {
    return null;
  }
  const config = readJson(path);
  const current = asObject(config["mcpServers"]);
  if (!isOurs(current[MCP_SERVER_KEY])) {
    return null;
  }
  const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== MCP_SERVER_KEY));
  if (Object.keys(rest).length === 0) {
    delete config["mcpServers"];
  } else {
    config["mcpServers"] = rest;
  }
  if (Object.keys(config).length === 0) {
    removeFileIfPresent(path);
    removeDirIfEmpty(dirname(path));
    return { path, action: "create" };
  }
  writeJson(path, config);
  return { path, action: "merge" };
}

// ---- hooks.json -------------------------------------------------------------

function hooksOf(config: Record<string, unknown>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [event, list] of Object.entries(asObject(config["hooks"]))) {
    const parsed = listSchema.safeParse(list);
    out[event] = parsed.success ? parsed.data : [];
  }
  return out;
}

function mergedHooks(path: string, launcher: string): Record<string, unknown> {
  const config = readJson(path);
  const hooks = hooksOf(config);
  for (const [event, list] of Object.entries(hooks)) {
    hooks[event] = list.filter((entry) => !isOurs(entry));
  }
  for (const def of CURSOR_HOOKS) {
    hooks[def.event] = [...(hooks[def.event] ?? []), hookEntry(launcher, def)];
  }
  return { ...config, version: typeof config["version"] === "number" ? config["version"] : 1, hooks };
}

export function hooksPresent(path: string): boolean {
  const hooks = hooksOf(readJson(path));
  return CURSOR_HOOKS.every((def) => (hooks[def.event] ?? []).some(isOurs));
}

export function planHooksChange(path: string, launcher: string): FileChange | null {
  const next = `${JSON.stringify(mergedHooks(path, launcher), null, 2)}\n`;
  if (existsSync(path) && readFileSync(path, "utf8") === next) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

export function writeHooks(path: string, launcher: string): void {
  writeJson(path, mergedHooks(path, launcher));
}

export function removeOurHooks(path: string): FileChange | null {
  if (!existsSync(path)) {
    return null;
  }
  const config = readJson(path);
  const hooks = hooksOf(config);
  let removed = false;
  const kept: Record<string, unknown[]> = {};
  for (const [event, list] of Object.entries(hooks)) {
    const rest = list.filter((entry) => !isOurs(entry));
    removed ||= rest.length !== list.length;
    if (rest.length > 0) {
      kept[event] = rest;
    }
  }
  if (!removed) {
    return null;
  }
  const otherKeys = Object.keys(config).filter((key) => key !== "hooks" && key !== "version");
  if (Object.keys(kept).length === 0 && otherKeys.length === 0) {
    removeFileIfPresent(path);
    removeDirIfEmpty(dirname(path));
    return { path, action: "create" };
  }
  writeJson(path, { ...config, hooks: kept });
  return { path, action: "merge" };
}
