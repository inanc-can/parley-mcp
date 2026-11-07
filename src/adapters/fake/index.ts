import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { removeDirIfEmpty, removeFileIfPresent } from "../fs-ops.js";
import type {
  Adapter,
  AdapterEnv,
  DetectReport,
  DoctorReport,
  FileChange,
  InstallReport,
} from "../types.js";

/** The user-level config file the fake adapter owns, relative to HOME. */
const CONFIG_REL = join(".parley-fake", "config.json");

/** The one key the adapter manages inside that file; other keys are left alone. */
const PARLEY_KEY = "parley";

const PARLEY_ENTRY = {
  command: "npx",
  args: ["parley-mcp", "serve"],
} as const;

const configSchema = z.record(z.string(), z.unknown());

/**
 * A stand-in harness adapter used to exercise the setup / uninstall / doctor
 * framework in M3 (real adapters are M4+). It writes one user-level JSON file,
 * merges its `parley` key without overwriting anything else, is idempotent, and
 * removes exactly what it added on uninstall.
 */
export const fakeAdapter: Adapter = {
  harness: "fake",

  detect(): Promise<DetectReport> {
    // The fake harness is always "installed" so setup has something to target.
    return Promise.resolve({ installed: true, version: "0.0.0-fake" });
  },

  install(env: AdapterEnv, dryRun: boolean): Promise<InstallReport> {
    const path = configPath(env);
    const existed = existsSync(path);
    const current = existed ? readConfig(path) : {};
    const alreadyWired = isWired(current);

    const changes: FileChange[] = alreadyWired
      ? []
      : [{ path, action: existed ? "merge" : "create" }];

    if (!dryRun && !alreadyWired) {
      const next = { ...current, [PARLEY_KEY]: { ...PARLEY_ENTRY } };
      writeConfig(path, next);
    }
    return Promise.resolve({ harness: "fake", changes, dryRun });
  },

  uninstall(env: AdapterEnv): Promise<InstallReport> {
    const path = configPath(env);
    if (!existsSync(path)) {
      return Promise.resolve({ harness: "fake", changes: [], dryRun: false });
    }
    const current = readConfig(path);
    if (!isWired(current)) {
      return Promise.resolve({ harness: "fake", changes: [], dryRun: false });
    }
    const otherKeys = Object.keys(current).filter((key) => key !== PARLEY_KEY);
    if (otherKeys.length === 0) {
      // We created the file (it holds only our key): remove it, then remove the
      // directory only if it is now empty. A directory that still holds other
      // files (anything the user put there) must survive — never recurse.
      removeFileIfPresent(path);
      removeDirIfEmpty(dirname(path));
      return Promise.resolve({
        harness: "fake",
        changes: [{ path, action: "create" }],
        dryRun: false,
      });
    }
    // We merged into an existing file: drop only our key, keep the rest.
    const next: Record<string, unknown> = {};
    for (const key of otherKeys) {
      next[key] = current[key];
    }
    writeConfig(path, next);
    return Promise.resolve({
      harness: "fake",
      changes: [{ path, action: "merge" }],
      dryRun: false,
    });
  },

  doctor(env: AdapterEnv): Promise<DoctorReport> {
    const path = configPath(env);
    const wired = existsSync(path) && isWired(readConfig(path));
    return Promise.resolve({
      harness: "fake",
      installed: true,
      canWakeIdle: wired,
      detail: wired
        ? "fake adapter wired; idle wake simulated"
        : "fake adapter not wired; run setup",
    });
  },
};

function configPath(env: AdapterEnv): string {
  return join(env.home, CONFIG_REL);
}

function readConfig(path: string): Record<string, unknown> {
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Pretty-printed with a trailing newline so a rewrite round-trips exactly. */
function writeConfig(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isWired(config: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(config, PARLEY_KEY);
}
