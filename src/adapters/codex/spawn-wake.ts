import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { launcherPath } from "../cli-path.js";

/**
 * Start `mcp-parley codex-wake --agent <id>` as a detached background process
 * through this install's launcher (never npx), so neither a `talk` call nor a
 * Codex hook waits on the app-server. Returns whether a process was started;
 * false when setup has not written the launcher yet (nothing to wake with).
 */
export type WakeSpawner = (agentId: string, waitSeconds: number) => boolean;

export function spawnCodexWake(home: string): WakeSpawner {
  return (agentId, waitSeconds) => {
    const launcher = launcherPath(home);
    if (!existsSync(launcher)) {
      return false;
    }
    try {
      const child = spawn(launcher, ["codex-wake", "--agent", agentId, "--wait-s", String(waitSeconds)], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => undefined); // a failed wake leaves the message queued; never crash the caller
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
}
