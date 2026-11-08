import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ensureLauncher, launcherPath } from "../cli-path.js";
import { pruneEmptyDirsUpTo, removeFileIfPresent } from "../fs-ops.js";
import {
  MCP_SERVER_KEY,
  OUR_LAUNCHER_SUFFIX,
  foreignEntryPresent,
  hasOurBlock,
  mcpEntryPresent,
  ourEntryPointsAtInstall,
  planConfigChange,
  removeConfigBlock,
  writeConfigBlock,
} from "../toml-merge.js";
import type { AdapterEnv, DoctorReport, FileChange, InstallReport } from "../types.js";
import { CONFIG_TOML_REL, GROK_DIR_REL, HOOKS_FILE_REL, SKILL_FILE_REL, hooksFileText, skillText } from "./config-files.js";

function paths(env: AdapterEnv): { configToml: string; hooksFile: string; skillFile: string; grokDir: string } {
  return {
    configToml: join(env.home, CONFIG_TOML_REL),
    hooksFile: join(env.home, HOOKS_FILE_REL),
    skillFile: join(env.home, SKILL_FILE_REL),
    grokDir: join(env.home, GROK_DIR_REL),
  };
}

/** A file is ours when it runs an mcp-parley launcher (hooks) or names our skill and launcher (skill). */
function fileIsOurs(path: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(OUR_LAUNCHER_SUFFIX);
}

/** Plan, and unless a dry run write, one file we fully own. Someone else's file is left alone. */
function ownFile(path: string, text: string, dryRun: boolean, changes: FileChange[], notes: string[]): void {
  if (existsSync(path)) {
    if (!fileIsOurs(path)) {
      notes.push(`${path} exists and was not written by mcp-parley; left it untouched`);
      return;
    }
    if (readFileSync(path, "utf8") === text) {
      return;
    }
  }
  changes.push({ path, action: existsSync(path) ? "merge" : "create" });
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
}

/**
 * Install the Grok Build integration (PLAN section 6 "Grok Build"): the
 * launcher, `[mcp_servers.mcp-parley]` in ~/.grok/config.toml (fenced block,
 * comments and other tables kept), our hooks file and our skill. Idempotent;
 * a foreign entry or file is never overwritten. A dry run writes nothing.
 */
export function installGrok(env: AdapterEnv, dryRun: boolean): InstallReport {
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
    notes.push(`~/.grok/config.toml already has an "${MCP_SERVER_KEY}" MCP server that mcp-parley did not create; left it untouched`);
  } else {
    const change = planConfigChange(p.configToml, launcher);
    if (change !== null) {
      changes.push(change);
      if (!dryRun) {
        writeConfigBlock(p.configToml, launcher, "grok");
      }
    }
  }
  ownFile(p.hooksFile, hooksFileText(launcher), dryRun, changes, notes);
  ownFile(p.skillFile, skillText(launcher), dryRun, changes, notes);
  if (!dryRun) {
    notes.push("Restart Grok so it loads the mcp-parley server, hooks and skill; `grok inspect` lists them.");
  }
  return { harness: "grok", changes, dryRun, notes };
}

/** Remove exactly what install added; never a recursive delete. */
export function uninstallGrok(env: AdapterEnv): InstallReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const changes: FileChange[] = [];
  const notes: string[] = [];
  if (existsSync(p.configToml)) {
    if (hasOurBlock(p.configToml)) {
      const change = removeConfigBlock(p.configToml);
      if (change !== null) {
        changes.push(change);
      }
    } else if (foreignEntryPresent(p.configToml)) {
      notes.push(`~/.grok/config.toml has an "${MCP_SERVER_KEY}" MCP server mcp-parley did not create; left it untouched`);
    }
  }
  for (const file of [p.hooksFile, p.skillFile]) {
    if (fileIsOurs(file) && removeFileIfPresent(file)) {
      changes.push({ path: file, action: "create" });
      pruneEmptyDirsUpTo(dirname(file), env.home);
    }
  }
  if (removeFileIfPresent(launcher)) {
    changes.push({ path: launcher, action: "create" });
  }
  pruneEmptyDirsUpTo(dirname(launcher), env.home);
  pruneEmptyDirsUpTo(p.grokDir, env.home);
  return { harness: "grok", changes, dryRun: false, notes };
}

/**
 * doctor: Grok can wake an idle session when the MCP server points at this
 * install and our hooks file and skill are in place. The wake itself is the
 * agent's persistent `monitor` running `inbox watch`, which it starts because
 * the skill, the MCP server's instructions and (once) the Stop hook tell it
 * to. Personal hooks need no trust (hooksTrusted null: not applicable).
 */
export function doctorGrok(env: AdapterEnv): DoctorReport {
  const p = paths(env);
  const launcher = launcherPath(env.home);
  const wired = mcpEntryPresent(p.configToml) && !foreignEntryPresent(p.configToml);
  const commandOk = ourEntryPointsAtInstall(p.configToml, launcher);
  const hooksOk = fileIsOurs(p.hooksFile);
  const skillOk = fileIsOurs(p.skillFile);
  const missing: string[] = [];
  if (!wired) {
    missing.push("MCP server not in ~/.grok/config.toml");
  } else if (!commandOk) {
    missing.push("MCP server command does not point at this install's launcher");
  }
  if (!hooksOk) {
    missing.push("~/.grok/hooks/mcp-parley.json missing");
  }
  if (!skillOk) {
    missing.push("~/.grok/skills/mcp-parley/SKILL.md missing");
  }
  return {
    harness: "grok",
    installed: wired || hooksOk,
    canWakeIdle: wired && commandOk && hooksOk && skillOk,
    hooksTrusted: null,
    detail:
      missing.length > 0
        ? `${missing.join("; ")}; run setup.`
        : "MCP server, hooks and skill in place. Idle wake needs the agent's persistent monitor (inbox watch); the skill and a one-time Stop reminder ask for it.",
  };
}
