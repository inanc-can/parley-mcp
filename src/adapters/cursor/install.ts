import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { ensureLauncher, launcherPath } from "../cli-path.js";
import { pruneEmptyDirsUpTo, removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { AdapterEnv, DoctorReport, FileChange, InstallReport } from "../types.js";
import { CURSOR_DIR_REL, HOOKS_JSON_REL, MCP_JSON_REL, MCP_SERVER_KEY } from "./config-files.js";
import {
  foreignMcpEntry,
  hooksPresent,
  mcpEntryPresent,
  mcpPointsAt,
  planHooksChange,
  planMcpChange,
  removeMcpEntry,
  removeOurHooks,
  writeHooks,
  writeMcpEntry,
} from "./json-merge.js";

function paths(env: AdapterEnv): { mcpJson: string; hooksJson: string; cursorDir: string } {
  return {
    mcpJson: join(env.home, MCP_JSON_REL),
    hooksJson: join(env.home, HOOKS_JSON_REL),
    cursorDir: join(env.home, CURSOR_DIR_REL),
  };
}

const RESTART_NOTE =
  "Cursor reloads hooks.json on save; start a new Cursor chat so the mcp-parley hooks and MCP server load (reload the window if the MCP server does not appear).";

/**
 * Install the Cursor integration (PLAN section 6 "Cursor"): the launcher, our
 * `mcp-parley` server in ~/.cursor/mcp.json, and our hooks in
 * ~/.cursor/hooks.json. User-level only, idempotent, merge-not-overwrite; a
 * foreign `mcp-parley` entry is left alone. A dry run writes nothing.
 */
export function installCursor(env: AdapterEnv, dryRun: boolean): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];
  const notes: string[] = [];
  if (!existsSync(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  if (!dryRun) {
    ensureLauncher(env.home);
  }
  if (foreignMcpEntry(p.mcpJson)) {
    notes.push(`~/.cursor/mcp.json already has an "${MCP_SERVER_KEY}" server that mcp-parley did not create; left it untouched`);
  } else {
    const change = planMcpChange(p.mcpJson, launcher);
    if (change !== null) {
      changes.push(change);
      if (!dryRun) {
        writeMcpEntry(p.mcpJson, launcher);
      }
    }
  }
  const hooksChange = planHooksChange(p.hooksJson, launcher);
  if (hooksChange !== null) {
    changes.push(hooksChange);
    if (!dryRun) {
      writeHooks(p.hooksJson, launcher);
    }
  }
  if (!dryRun) {
    notes.push(RESTART_NOTE);
  }
  return { harness: "cursor", changes, dryRun, notes };
}

/** Remove only what install added; never a recursive delete. */
export function uninstallCursor(env: AdapterEnv): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];
  const notes: string[] = [];
  if (foreignMcpEntry(p.mcpJson)) {
    notes.push(`~/.cursor/mcp.json has an "${MCP_SERVER_KEY}" server mcp-parley did not create; left it untouched`);
  }
  for (const change of [removeMcpEntry(p.mcpJson), removeOurHooks(p.hooksJson)]) {
    if (change !== null) {
      changes.push(change);
    }
  }
  removeDirIfEmpty(p.cursorDir);
  if (removeFileIfPresent(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  pruneEmptyDirsUpTo(dirname(launcher), env.home);
  return { harness: "cursor", changes, dryRun: false, notes };
}

/**
 * doctor: Cursor can wake an idle chat when our MCP server points at this
 * install and all our hooks are present: sessionStart tells the agent to keep
 * one background `inbox watch --once` running, whose completion resumes it,
 * and stop delivers anything queued as a follow-up. Cursor user hooks need no
 * trust step (hooksTrusted is null: not applicable). The wake still depends on
 * the agent following that instruction, which only a live chat shows.
 */
export function doctorCursor(env: AdapterEnv): DoctorReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const wired = mcpEntryPresent(p.mcpJson) && !foreignMcpEntry(p.mcpJson);
  const commandOk = mcpPointsAt(p.mcpJson, launcher);
  const hooksOk = hooksPresent(p.hooksJson);
  const missing: string[] = [];
  if (!wired) {
    missing.push("MCP server not in ~/.cursor/mcp.json");
  } else if (!commandOk) {
    missing.push("MCP server command does not point at this install's launcher");
  }
  if (!hooksOk) {
    missing.push("~/.cursor/hooks.json is missing mcp-parley hooks");
  }
  return {
    harness: "cursor",
    installed: wired || hooksOk,
    canWakeIdle: wired && commandOk && hooksOk,
    hooksTrusted: null,
    detail:
      missing.length > 0
        ? `${missing.join("; ")}; run setup.`
        : "MCP server and hooks wired. Each new chat is told to keep one background inbox watch running; that is what wakes it when idle.",
  };
}
