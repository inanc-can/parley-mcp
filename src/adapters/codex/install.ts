import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { ensureLauncher, launcherPath } from "../cli-path.js";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type { AdapterEnv, DoctorReport, FileChange, InstallReport } from "../types.js";
import { codexAppServerReachable } from "./app-server.js";
import { CODEX_DIR_REL, CONFIG_TOML_REL, HOOKS_JSON_REL, MCP_SERVER_KEY } from "./config-files.js";
import { hooksFileHasOurs, planHooksChange, removeOurHooks, writeHooksJson } from "./hooks-merge.js";
import {
  foreignEntryPresent,
  hasOurBlock,
  mcpEntryPresent,
  ourEntryPointsAtInstall,
  planConfigChange,
  removeConfigBlock,
  writeConfigBlock,
} from "./toml-merge.js";

interface Paths {
  configToml: string;
  hooksJson: string;
  codexDir: string;
}

function paths(env: AdapterEnv): Paths {
  return {
    configToml: join(env.home, CONFIG_TOML_REL),
    hooksJson: join(env.home, HOOKS_JSON_REL),
    codexDir: join(env.home, CODEX_DIR_REL),
  };
}

const TRUST_NOTE =
  "Codex requires you to trust new hooks before they run: open Codex and run /hooks, review the mcp-parley hooks, trust them, then restart your sessions.";

/**
 * Install the Codex integration (PLAN section 6 "Codex"):
 *  - write this install's launcher (~/.mcp-parley/bin/mcp-parley),
 *  - merge `[mcp_servers.mcp-parley]` into ~/.codex/config.toml by APPENDING a
 *    fenced managed block (comments + every other table preserved untouched),
 *  - merge our lifecycle hooks into ~/.codex/hooks.json (the user's hooks kept).
 *
 * User-level only, idempotent, merge-not-overwrite. A dry run writes nothing.
 * Nothing generated runs `npx`; the command is always the absolute launcher.
 * A foreign `mcp-parley` config entry is left untouched and reported in `notes`.
 */
export function installCodex(env: AdapterEnv, dryRun: boolean): InstallReport {
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

  if (foreignEntryPresent(p.configToml)) {
    notes.push(
      `~/.codex/config.toml already has an "${MCP_SERVER_KEY}" MCP server that mcp-parley did not create; left it untouched`,
    );
  } else {
    const configChange = planConfigChange(p.configToml, launcher);
    if (configChange !== null) {
      changes.push(configChange);
      if (!dryRun) {
        writeConfigBlock(p.configToml, launcher);
      }
    }
  }

  const hooksChange = planHooksChange(p.hooksJson, launcher);
  if (hooksChange !== null) {
    changes.push(hooksChange);
    if (!dryRun) {
      writeHooksJson(p.hooksJson, launcher);
    }
  }

  if (!dryRun) {
    notes.push(TRUST_NOTE);
  }

  return { harness: "codex", changes, dryRun, notes };
}

/**
 * Uninstall: excise our fenced block from config.toml (the rest byte for byte),
 * remove only our hooks from hooks.json, remove the launcher, and prune
 * now-empty dirs. Never a recursive delete; a foreign `mcp-parley` entry and any
 * user content survive.
 */
export function uninstallCodex(env: AdapterEnv): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];
  const notes: string[] = [];

  if (existsSync(p.configToml)) {
    if (foreignEntryPresent(p.configToml) && !hasOurBlock(p.configToml)) {
      notes.push(
        `~/.codex/config.toml has an "${MCP_SERVER_KEY}" MCP server mcp-parley did not create; left it untouched`,
      );
    } else if (hasOurBlock(p.configToml)) {
      const configChange = removeConfigBlock(p.configToml);
      if (configChange !== null) {
        changes.push(configChange);
      }
    }
  }

  if (existsSync(p.hooksJson)) {
    const hooksChange = removeOurHooks(p.hooksJson);
    if (hooksChange !== null) {
      changes.push(hooksChange);
    } else {
      notes.push("~/.codex/hooks.json has no mcp-parley handlers; left it untouched");
    }
  }

  removeDirIfEmpty(p.codexDir);

  if (removeFileIfPresent(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  pruneLauncherDirs(launcher, env.home);

  return { harness: "codex", changes, dryRun: false, notes };
}

/**
 * doctor: Codex can wake an idle session only when (a) the MCP server is wired
 * in config.toml with its command pointing at THIS install's launcher, (b) our
 * hooks are present in hooks.json, and (c) the app-server is reachable (the
 * idle-wake transport; without it we fall back to hooks + queue, which is NOT a
 * from-idle wake). Hook TRUST can't be read non-interactively (the user trusts
 * via /hooks), so doctor reports hooksTrusted as unknown (null), never trusted.
 */
export function doctorCodex(
  env: AdapterEnv,
  appServerReachable: () => boolean = codexAppServerReachable,
): DoctorReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const mcpWired = mcpEntryPresent(p.configToml) && !foreignEntryPresent(p.configToml);
  const commandOk = ourEntryPointsAtInstall(p.configToml, launcher);
  const hooksPresent = existsSync(p.hooksJson) && hooksFileHasOurs(p.hooksJson);
  const appServerOk = appServerReachable();
  const canWakeIdle = mcpWired && commandOk && hooksPresent && appServerOk;
  return {
    harness: "codex",
    installed: mcpWired || hooksPresent,
    canWakeIdle,
    hooksTrusted: null,
    detail: detailLine(mcpWired, commandOk, hooksPresent, appServerOk),
  };
}

function detailLine(
  mcpWired: boolean,
  commandOk: boolean,
  hooksPresent: boolean,
  appServerOk: boolean,
): string {
  const missing: string[] = [];
  if (!mcpWired) {
    missing.push("MCP server not in ~/.codex/config.toml");
  } else if (!commandOk) {
    missing.push("MCP server command does not point at this install's launcher");
  }
  if (!hooksPresent) {
    missing.push("~/.codex/hooks.json missing our handlers");
  }
  if (!appServerOk) {
    missing.push("codex app-server not reachable (idle wake falls back to queue-until-next-turn)");
  }
  if (missing.length === 0) {
    return "MCP server wired, hooks written, app-server reachable; trust the hooks with /hooks to let them run.";
  }
  return `${missing.join("; ")}; run setup (and trust hooks with /hooks).`;
}

/** Prune the launcher's bin/ and data dir, each only if now empty. */
function pruneLauncherDirs(launcher: string, home: string): void {
  let dir = dirname(launcher);
  while (dir !== home && dir.startsWith(home)) {
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
