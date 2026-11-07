import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { FileChange } from "../types.js";
import { BLOCK_BEGIN, BLOCK_END, MCP_SERVER_KEY, managedConfigBlock } from "./config-files.js";

/**
 * Surgical, comment-preserving merge of our `[mcp_servers.mcp-parley]` table
 * into ~/.codex/config.toml. We append a fenced managed block (never
 * reserialize the whole file with smol-toml's stringify, which would drop
 * comments), and `smol-toml`'s `parse` is used only to INSPECT the file
 * (detect our/foreign entries). install→uninstall restores the prior bytes.
 */

/** Our launcher's path suffix: an MCP command ending with it is ours. */
export const OUR_LAUNCHER_SUFFIX = "/.mcp-parley/bin/mcp-parley";

const mcpEntrySchema = z.looseObject({ command: z.string() });
const tableSchema = z.record(z.string(), z.unknown());

/** Parse config.toml defensively; return the top-level table or null. */
function readConfig(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  const parsed: unknown = parseToml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  return tableSchema.parse(parsed);
}

function mcpServers(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config["mcp_servers"];
  if (existing !== undefined && existing !== null && typeof existing === "object") {
    return tableSchema.parse(existing);
  }
  return {};
}

/** True when a `[mcp_servers.mcp-parley]` table exists (ours or someone else's). */
export function mcpEntryPresent(path: string): boolean {
  const config = readConfig(path);
  return config !== null && Object.prototype.hasOwnProperty.call(mcpServers(config), MCP_SERVER_KEY);
}

/** True when the existing `mcp-parley` entry's command is an mcp-parley launcher. */
function isOurEntry(path: string): boolean {
  const config = readConfig(path);
  if (config === null) {
    return false;
  }
  const parsed = mcpEntrySchema.safeParse(mcpServers(config)[MCP_SERVER_KEY]);
  return parsed.success && parsed.data.command.endsWith(OUR_LAUNCHER_SUFFIX);
}

/** True when the entry is present AND its command is exactly this install's launcher. */
export function ourEntryPointsAtInstall(path: string, launcher: string): boolean {
  const config = readConfig(path);
  if (config === null) {
    return false;
  }
  const parsed = mcpEntrySchema.safeParse(mcpServers(config)[MCP_SERVER_KEY]);
  return parsed.success && parsed.data.command === launcher;
}

/** True when a `mcp-parley` entry exists that mcp-parley did NOT create. */
export function foreignEntryPresent(path: string): boolean {
  return mcpEntryPresent(path) && !isOurEntry(path);
}

export function hasOurBlock(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const text = readFileSync(path, "utf8");
  return text.includes(BLOCK_BEGIN) && text.includes(BLOCK_END);
}

export function planConfigChange(path: string, launcher: string): FileChange | null {
  if (hasOurBlock(path) && ourEntryPointsAtInstall(path, launcher)) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

/**
 * Append (or replace in place) our fenced managed block.
 *
 * Layout written when prior text is non-empty:
 *   <priorText ending in exactly one "\n">\n<BLOCK_BEGIN>\n...\n<BLOCK_END>\n
 * i.e. prior text, a single blank-line separator, then our block. When prior
 * text is empty, the file is our block alone. `stripOurBlock` reverses exactly
 * this, so install→uninstall restores the prior bytes.
 */
export function writeConfigBlock(path: string, launcher: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const priorText = stripOurBlock(existing);
  const next =
    priorText.length === 0
      ? managedConfigBlock(launcher)
      : `${ensureTrailingNewline(priorText)}\n${managedConfigBlock(launcher)}`;
  writeFileSync(path, next, "utf8");
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Return the text with our fenced block removed, reversing `writeConfigBlock`'s
 * layout exactly. Text without our markers is returned unchanged.
 */
function stripOurBlock(text: string): string {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin === -1) {
    return text;
  }
  const endMarker = text.indexOf(BLOCK_END, begin);
  if (endMarker === -1) {
    return text;
  }
  let after = endMarker + BLOCK_END.length;
  if (text[after] === "\n") {
    after += 1; // the newline terminating our block
  }
  // The char before BLOCK_BEGIN is the separator "\n" we inserted; drop it, so
  // the prior text keeps only its own trailing newline.
  let keepUpTo = begin;
  if (keepUpTo >= 1 && text[keepUpTo - 1] === "\n") {
    keepUpTo -= 1;
  }
  return text.slice(0, keepUpTo) + text.slice(after);
}

export function removeConfigBlock(path: string): FileChange | null {
  const text = readFileSync(path, "utf8");
  const stripped = stripOurBlock(text);
  if (stripped === text) {
    return null;
  }
  if (stripped.trim().length === 0) {
    removeFileIfPresent(path);
    removeDirIfEmpty(dirname(path));
    return { path, action: "create" };
  }
  writeFileSync(path, stripped, "utf8");
  return { path, action: "merge" };
}
