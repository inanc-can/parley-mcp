import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { AdapterEnv, DoctorReport, FileChange, InstallReport } from "../types.js";
import {
  CLAUDE_JSON_REL,
  MCP_SERVER_ENTRY,
  MCP_SERVER_KEY,
  PLUGIN_DIR_REL,
  pluginFiles,
  type PluginFile,
} from "./plugin-files.js";

const claudeJsonSchema = z.record(z.string(), z.unknown());

interface Paths {
  claudeJson: string;
  pluginDir: string;
}

function paths(env: AdapterEnv): Paths {
  return {
    claudeJson: join(env.home, CLAUDE_JSON_REL),
    pluginDir: join(env.home, PLUGIN_DIR_REL),
  };
}

/**
 * Install the Claude Code integration: merge the MCP server into ~/.claude.json
 * and write the plugin files. User-level only, idempotent, merge-not-overwrite.
 */
export function installClaudeCode(env: AdapterEnv, dryRun: boolean): InstallReport {
  const p = paths(env);
  const changes: FileChange[] = [];

  const mcpChange = planMcpChange(p.claudeJson);
  if (mcpChange !== null) {
    changes.push(mcpChange);
    if (!dryRun) {
      writeMcpEntry(p.claudeJson);
    }
  }

  for (const file of pluginFiles()) {
    const target = join(p.pluginDir, file.rel);
    const change = planFileChange(target, file);
    if (change === null) {
      continue;
    }
    changes.push(change);
    if (!dryRun) {
      writePluginFile(target, file);
    }
  }

  return { harness: "claude-code", changes, dryRun };
}

/**
 * Uninstall: remove exactly what install created — the plugin files, then any
 * now-empty plugin directories, then the `parley` key from ~/.claude.json
 * (removing that file only if it existed solely for us and is now empty).
 */
export function uninstallClaudeCode(env: AdapterEnv): InstallReport {
  const p = paths(env);
  const changes: FileChange[] = [];

  for (const file of pluginFiles()) {
    const target = join(p.pluginDir, file.rel);
    if (removeFileIfPresent(target)) {
      changes.push({ path: target, action: "create" });
    }
  }
  pruneEmptyPluginDirs(p.pluginDir, env.home);

  const mcpChange = removeMcpEntry(p.claudeJson);
  if (mcpChange !== null) {
    changes.push(mcpChange);
  }

  return { harness: "claude-code", changes, dryRun: false };
}

export function doctorClaudeCode(env: AdapterEnv): DoctorReport {
  const p = paths(env);
  const mcpWired = isMcpWired(p.claudeJson);
  const pluginPresent = pluginFiles().every((file) => existsSync(join(p.pluginDir, file.rel)));
  const canWakeIdle = mcpWired && pluginPresent;
  return {
    harness: "claude-code",
    installed: mcpWired || pluginPresent,
    canWakeIdle,
    // Claude Code plugins/monitors don't need per-hook trust (unlike Codex).
    hooksTrusted: null,
    detail: detailLine(mcpWired, pluginPresent),
  };
}

function detailLine(mcpWired: boolean, pluginPresent: boolean): string {
  if (mcpWired && pluginPresent) {
    return "MCP server wired in ~/.claude.json and plugin installed; monitor wakes idle sessions.";
  }
  const missing: string[] = [];
  if (!mcpWired) {
    missing.push("MCP server not in ~/.claude.json");
  }
  if (!pluginPresent) {
    missing.push("plugin files missing");
  }
  return `${missing.join("; ")}; run setup.`;
}

// --- ~/.claude.json mcpServers merge -------------------------------------

function readClaudeJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  return claudeJsonSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function mcpServers(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config["mcpServers"];
  if (existing !== undefined && existing !== null && typeof existing === "object") {
    return claudeJsonSchema.parse(existing);
  }
  return {};
}

function isMcpWired(path: string): boolean {
  const config = readClaudeJson(path);
  if (config === null) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(mcpServers(config), MCP_SERVER_KEY);
}

function planMcpChange(path: string): FileChange | null {
  if (isMcpWired(path)) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

function writeMcpEntry(path: string): void {
  const config = readClaudeJson(path) ?? {};
  const servers = mcpServers(config);
  const nextServers = { ...servers, [MCP_SERVER_KEY]: { ...MCP_SERVER_ENTRY } };
  const next = { ...config, mcpServers: nextServers };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function removeMcpEntry(path: string): FileChange | null {
  const config = readClaudeJson(path);
  if (config === null) {
    return null;
  }
  const servers = mcpServers(config);
  if (!Object.prototype.hasOwnProperty.call(servers, MCP_SERVER_KEY)) {
    return null;
  }
  const nextServers: Record<string, unknown> = {};
  for (const key of Object.keys(servers)) {
    if (key !== MCP_SERVER_KEY) {
      nextServers[key] = servers[key];
    }
  }
  const otherTopKeys = Object.keys(config).filter((key) => key !== "mcpServers");
  if (otherTopKeys.length === 0 && Object.keys(nextServers).length === 0) {
    // The file existed only to hold our server: remove it, prune if empty.
    removeFileIfPresent(path);
    removeDirIfEmpty(dirname(path));
    return { path, action: "create" };
  }
  const next: Record<string, unknown> = {};
  for (const key of otherTopKeys) {
    next[key] = config[key];
  }
  if (Object.keys(nextServers).length > 0) {
    next["mcpServers"] = nextServers;
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { path, action: "merge" };
}

// --- plugin files --------------------------------------------------------

function planFileChange(target: string, file: PluginFile): FileChange | null {
  if (existsSync(target) && readFileSync(target, "utf8") === file.contents) {
    return null;
  }
  return { path: target, action: existsSync(target) ? "merge" : "create" };
}

function writePluginFile(target: string, file: PluginFile): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.contents, "utf8");
  if (file.rel.endsWith(".sh")) {
    chmodSync(target, 0o755);
  }
}

/**
 * Remove now-empty directories from the deepest plugin subdirectory up to (and
 * including) the plugin root, but never above it: `~/.claude` and
 * `~/.claude/plugins` are only removed if they too are empty and sit below HOME.
 */
function pruneEmptyPluginDirs(pluginDir: string, home: string): void {
  const dirs = new Set<string>();
  for (const file of pluginFiles()) {
    let dir = dirname(join(pluginDir, file.rel));
    while (isUnder(dir, home) && dir !== home) {
      dirs.add(dir);
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  // Deepest first so a parent only empties after its children are gone.
  const ordered = [...dirs].sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      removeDirIfEmpty(dir);
    }
  }
}

function isUnder(path: string, base: string): boolean {
  const rel = relative(base, path);
  return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith(sep);
}
