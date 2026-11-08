import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "./fs-ops.js";
import type { FileChange } from "./types.js";

/**
 * The key Parley manages inside config.toml's `mcp_servers` table and the
 * hooks.json ownership marker. Same name as the Claude adapter: `mcp-parley`,
 * never `parley` (another tool registers `parley`; the M4 live test showed
 * setup overwriting it). Setup never overwrites, and uninstall never removes,
 * a `[mcp_servers.mcp-parley]` entry that mcp-parley did not create (its
 * command must be an mcp-parley launcher — see install.ts `isOurEntry`).
 */
export const MCP_SERVER_KEY = "mcp-parley";

/** The TOML table header for our MCP server. */
export const MCP_TABLE_HEADER = `[mcp_servers.${MCP_SERVER_KEY}]`;

/**
 * Our `[mcp_servers.mcp-parley]` block as exact TOML text. We render it by hand
 * (not via smol-toml's stringify, which drops comments on the whole file) so a
 * surgical append/remove round-trips the rest of config.toml byte for byte.
 *
 * `command` is the absolute launcher path (never `npx`). The nested
 * `[mcp_servers.mcp-parley.env]` sets PARLEY_HARNESS to the harness (codex,
 * grok) so the per-session MCP server resolves the SAME `<harness>@<folder>` id its hooks use —
 * the identity-split fix proved necessary in M4.
 */
export function mcpTableBlock(launcherPath: string, harness: string): string {
  return [
    MCP_TABLE_HEADER,
    `command = ${tomlString(launcherPath)}`,
    `args = ["serve"]`,
    "",
    `[mcp_servers.${MCP_SERVER_KEY}.env]`,
    `PARLEY_HARNESS = ${tomlString(harness)}`,
    "",
  ].join("\n");
}

/** A begin/end marker comment pair so uninstall can excise exactly our block. */
export const BLOCK_BEGIN = "# >>> mcp-parley (managed by mcp-parley setup; do not edit) >>>";
export const BLOCK_END = "# <<< mcp-parley <<<";

/** Our full managed block, fenced by markers, ready to append to config.toml. */
export function managedConfigBlock(launcherPath: string, harness: string): string {
  return [BLOCK_BEGIN, mcpTableBlock(launcherPath, harness), BLOCK_END, ""].join("\n");
}

/** Minimal TOML basic-string escaping for a path value. */
function tomlString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Surgical, comment-preserving merge of our `[mcp_servers.mcp-parley]` table
 * into a harness's config.toml (~/.codex, ~/.grok). We append a fenced managed block (never
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
export function writeConfigBlock(path: string, launcher: string, harness: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const priorText = stripOurBlock(existing);
  const next =
    priorText.length === 0
      ? managedConfigBlock(launcher, harness)
      : `${ensureTrailingNewline(priorText)}\n${managedConfigBlock(launcher, harness)}`;
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
