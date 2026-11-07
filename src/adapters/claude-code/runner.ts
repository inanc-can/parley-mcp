import { spawnSync } from "node:child_process";

/**
 * An injectable runner for the `claude` CLI. Install/uninstall/doctor need to
 * invoke `claude plugin ...`; a fake runner in tests records the calls and
 * returns canned output so tests never shell out to the real `claude`.
 */
export interface CommandResult {
  /** Process exit code (0 = success). */
  code: number;
  /** Captured stdout (used by doctor to read `plugin list --json`). */
  stdout: string;
  /** Captured stderr (for diagnostics). */
  stderr: string;
}

export interface CommandRunner {
  /** Run `claude <args...>` and capture its result. Must never throw. */
  run(args: readonly string[]): CommandResult;
}

/**
 * The default runner: spawns the real `claude` binary synchronously. It never
 * throws — a missing binary or non-zero exit is reported in the result so
 * callers can decide (install reports the failure; doctor treats it as
 * not-installed). Nothing here runs in tests.
 */
export const defaultClaudeRunner: CommandRunner = {
  run(args: readonly string[]): CommandResult {
    const result = spawnSync("claude", [...args], { encoding: "utf8" });
    if (result.error !== undefined) {
      return { code: 127, stdout: "", stderr: result.error.message };
    }
    return {
      code: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};
