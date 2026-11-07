import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../store/index.js";

export const DB_PATH_ENV = "PARLEY_DB_PATH";

/**
 * The hub database path. Defaults to the one machine-wide file
 * `~/.mcp-parley/hub.db` (PLAN section 2); `PARLEY_DB_PATH` overrides it so a
 * harness or a test can point the CLI at a scratch database.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DB_PATH_ENV];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const home = env["HOME"] ?? homedir();
  return join(home, ".mcp-parley", "hub.db");
}

/**
 * Discovery groups agents by repository (PLAN "repo = git top-level path").
 * We ask git for the working tree's top level and fall back to the current
 * directory when the folder is not a git repo. Never throws: a non-repo folder
 * is still a valid place to talk.
 */
export function resolveRepoRoot(cwd: string = process.cwd()): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const top = out.trim();
    return top.length > 0 ? top : cwd;
  } catch {
    return cwd;
  }
}

/** Open the hub db for a CLI command. The caller closes it. */
export function openHubDb(env: NodeJS.ProcessEnv = process.env): Db {
  return openDb({ path: resolveDbPath(env) });
}
