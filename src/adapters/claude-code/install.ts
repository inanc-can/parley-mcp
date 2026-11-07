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
import { ensureLauncher, launcherPath } from "../cli-path.js";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { AdapterEnv, DoctorReport, FileChange, InstallReport } from "../types.js";
import { readPluginState, registerPlugin, unregisterPlugin } from "./plugin-commands.js";
import {
  CLAUDE_JSON_REL,
  MARKETPLACE_DIR_REL,
  MCP_SERVER_KEY,
  MONITOR_SCRIPT_REL,
  mcpServerEntry,
  pluginFiles,
  type PluginFile,
} from "./plugin-files.js";
import { defaultClaudeRunner, type CommandRunner } from "./runner.js";

const claudeJsonSchema = z.record(z.string(), z.unknown());

/** The shape of our MCP entry we read back to confirm its `command`. */
const mcpEntrySchema = z.looseObject({ command: z.string() });

interface Paths {
  claudeJson: string;
  marketplaceDir: string;
}

function paths(env: AdapterEnv): Paths {
  return {
    claudeJson: join(env.home, CLAUDE_JSON_REL),
    marketplaceDir: join(env.home, MARKETPLACE_DIR_REL),
  };
}

/**
 * Install the Claude Code integration: write this install's launcher
 * (~/.mcp-parley/bin/mcp-parley), merge the MCP server into ~/.claude.json
 * pointing at that launcher's absolute path, write the local marketplace
 * (marketplace manifest + plugin, every script invoking the launcher) under
 * ~/.mcp-parley/claude-marketplace, then register and install the plugin
 * through the injectable `runner`. User-level only, idempotent,
 * merge-not-overwrite. A dry run writes nothing and runs no commands.
 *
 * NOTHING generated here runs `npx`: the command is always the absolute
 * launcher path (the review's HIGH security finding).
 */
export function installClaudeCode(
  env: AdapterEnv,
  dryRun: boolean,
  runner: CommandRunner = defaultClaudeRunner,
): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];
  const notes: string[] = [];

  // The launcher must exist before the configs that point at it. We create it
  // on a real run only; a dry run reports it as a change but writes nothing.
  if (!existsSync(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  if (!dryRun) {
    ensureLauncher(env.home);
  }

  const mcpChange = planMcpChange(p.claudeJson, launcher);
  if (mcpChange !== null) {
    changes.push(mcpChange);
    if (!dryRun) {
      writeMcpEntry(p.claudeJson, launcher);
    }
  }

  for (const file of pluginFiles(launcher)) {
    const target = join(p.marketplaceDir, file.rel);
    const change = planFileChange(target, file);
    if (change === null) {
      continue;
    }
    changes.push(change);
    if (!dryRun) {
      writePluginFile(target, file);
    }
  }

  if (!dryRun) {
    // Register the marketplace and install the plugin every time: these are
    // idempotent in Claude Code (re-adding/re-installing is a no-op) and ensure
    // the plugin is enabled even if the files were already present. Any
    // non-zero `claude` step is surfaced (review finding: failures were
    // dropped, so setup reported success when `claude` was missing or failed).
    notes.push(...registerPlugin(runner, p.marketplaceDir));
  }

  return { harness: "claude-code", changes, dryRun, notes };
}

/**
 * Uninstall: unregister the plugin and marketplace through the runner, then
 * remove exactly the files install created (launcher, marketplace tree) and the
 * `parley` key from ~/.claude.json (removing that file only if it existed
 * solely for us and is now empty). Never a recursive delete of anything install
 * did not make. Any non-zero `claude` step is surfaced in `notes`.
 */
export function uninstallClaudeCode(
  env: AdapterEnv,
  runner: CommandRunner = defaultClaudeRunner,
): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];

  const notes = unregisterPlugin(runner);

  for (const file of pluginFiles(launcher)) {
    const target = join(p.marketplaceDir, file.rel);
    if (removeFileIfPresent(target)) {
      changes.push({ path: target, action: "create" });
    }
  }
  pruneEmptyPluginDirs(p.marketplaceDir, env.home, launcher);

  // Remove the launcher and prune its now-empty bin/ and data dir (only if they
  // hold nothing else — never recursive; a user file under ~/.mcp-parley lives).
  if (removeFileIfPresent(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  pruneLauncherDirs(launcher, env.home);

  const mcpChange = removeMcpEntry(p.claudeJson);
  if (mcpChange !== null) {
    changes.push(mcpChange);
  }

  return { harness: "claude-code", changes, dryRun: false, notes };
}

/**
 * doctor: we can wake an idle session only when (a) the MCP server is wired in
 * ~/.claude.json AND its command points at THIS install's launcher (not `npx`,
 * not some other path), (b) the marketplace files (including the monitor
 * script) exist, and (c) `claude plugin list --json` shows our plugin installed
 * AND enabled. If the CLI can't be reached we report cannot-wake-idle with a
 * reason rather than a false positive from file existence alone.
 */
export function doctorClaudeCode(
  env: AdapterEnv,
  runner: CommandRunner = defaultClaudeRunner,
): DoctorReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const mcpWired = isMcpWired(p.claudeJson);
  const commandOk = mcpCommandPointsAtInstall(p.claudeJson, launcher);
  const filesPresent = pluginFiles(launcher).every((file) =>
    existsSync(join(p.marketplaceDir, file.rel)),
  );
  const monitorPresent = existsSync(join(p.marketplaceDir, MONITOR_SCRIPT_REL));
  const pluginState = readPluginState(runner);
  const canWakeIdle =
    mcpWired && commandOk && filesPresent && monitorPresent && pluginState.installedAndEnabled;
  return {
    harness: "claude-code",
    installed: mcpWired || filesPresent,
    canWakeIdle,
    // Claude Code plugins/monitors don't need per-hook trust (unlike Codex).
    hooksTrusted: null,
    detail: detailLine(mcpWired, commandOk, filesPresent, monitorPresent, pluginState),
  };
}

function detailLine(
  mcpWired: boolean,
  commandOk: boolean,
  filesPresent: boolean,
  monitorPresent: boolean,
  pluginState: { available: boolean; installedAndEnabled: boolean },
): string {
  if (mcpWired && commandOk && filesPresent && monitorPresent && pluginState.installedAndEnabled) {
    return "MCP server wired to this install's launcher, plugin installed and enabled; monitor wakes idle sessions.";
  }
  const missing: string[] = [];
  if (!mcpWired) {
    missing.push("MCP server not in ~/.claude.json");
  } else if (!commandOk) {
    missing.push("MCP server command does not point at this install's launcher");
  }
  if (!filesPresent) {
    missing.push("marketplace/plugin files missing");
  }
  if (!monitorPresent) {
    missing.push("monitor script missing");
  }
  if (!pluginState.available) {
    missing.push("could not run `claude plugin list --json`");
  } else if (!pluginState.installedAndEnabled) {
    missing.push("plugin not installed or not enabled in Claude Code");
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

/** True when our MCP entry's `command` is exactly this install's launcher path. */
function mcpCommandPointsAtInstall(path: string, launcher: string): boolean {
  const config = readClaudeJson(path);
  if (config === null) {
    return false;
  }
  const entry = mcpServers(config)[MCP_SERVER_KEY];
  const parsed = mcpEntrySchema.safeParse(entry);
  return parsed.success && parsed.data.command === launcher;
}

function planMcpChange(path: string, launcher: string): FileChange | null {
  // A change is needed when our server is absent OR its command is stale
  // (points at `npx` or another path from an older install).
  if (isMcpWired(path) && mcpCommandPointsAtInstall(path, launcher)) {
    return null;
  }
  return { path, action: existsSync(path) ? "merge" : "create" };
}

function writeMcpEntry(path: string, launcher: string): void {
  const config = readClaudeJson(path) ?? {};
  const servers = mcpServers(config);
  const nextServers = { ...servers, [MCP_SERVER_KEY]: mcpServerEntry(launcher) };
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
 * Remove now-empty directories from the deepest marketplace subdirectory up to
 * (and including) the marketplace root, but never above it. A directory that
 * still holds files install did not create is left untouched.
 */
function pruneEmptyPluginDirs(marketplaceDir: string, home: string, launcher: string): void {
  const dirs = new Set<string>();
  for (const file of pluginFiles(launcher)) {
    let dir = dirname(join(marketplaceDir, file.rel));
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

/** Prune the launcher's bin/ and the data dir, each only if now empty. */
function pruneLauncherDirs(launcher: string, home: string): void {
  let dir = dirname(launcher);
  while (isUnder(dir, home) && dir !== home) {
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

function isUnder(path: string, base: string): boolean {
  const rel = relative(base, path);
  return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith(sep);
}
