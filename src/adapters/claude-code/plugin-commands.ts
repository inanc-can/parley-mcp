import { z } from "zod";
import { MARKETPLACE_NAME, PLUGIN_NAME } from "./plugin-files.js";
import type { CommandRunner } from "./runner.js";

/** The install target Claude Code uses: plugin@marketplace. */
export const PLUGIN_REF = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * Register the local marketplace and install the plugin at user scope (PLAN
 * section 6; .workbench/tasks/M4/plugin-loading.md). Each step runs through the
 * injectable runner so tests never call the real `claude`. Steps that fail are
 * collected and returned, not thrown: setup reports them and the human's live
 * test confirms the result.
 */
export function registerPlugin(runner: CommandRunner, marketplaceDir: string): string[] {
  const failures: string[] = [];
  const steps: { label: string; args: readonly string[] }[] = [
    { label: "validate", args: ["plugin", "validate", marketplaceDir, "--strict"] },
    {
      label: "marketplace add",
      args: ["plugin", "marketplace", "add", marketplaceDir, "--scope", "user"],
    },
    { label: "install", args: ["plugin", "install", PLUGIN_REF, "--scope", "user"] },
  ];
  for (const step of steps) {
    const result = runner.run(step.args);
    if (result.code !== 0) {
      failures.push(
        `claude ${step.label} failed (exit ${String(result.code)}): ${(result.stderr.trim() || result.stdout.trim()).slice(0, 500)}`,
      );
    }
  }
  return failures;
}

/**
 * Remove the plugin and the marketplace registration (the inverse of
 * `registerPlugin`). Failures are collected, not thrown (the files are removed
 * regardless so uninstall leaves no trace).
 */
export function unregisterPlugin(runner: CommandRunner): string[] {
  const failures: string[] = [];
  const steps: { label: string; args: readonly string[] }[] = [
    { label: "uninstall", args: ["plugin", "uninstall", PLUGIN_REF, "--scope", "user"] },
    {
      label: "marketplace remove",
      args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--scope", "user"],
    },
  ];
  for (const step of steps) {
    const result = runner.run(step.args);
    if (result.code !== 0) {
      failures.push(
        `claude ${step.label} failed (exit ${String(result.code)}): ${(result.stderr.trim() || result.stdout.trim()).slice(0, 500)}`,
      );
    }
  }
  return failures;
}

/**
 * One entry in `claude plugin list --json`. We parse defensively: the exact
 * shape is unverified (docs/harness-notes.md records the assumed shape), so we
 * accept several likely key spellings and ignore everything else. A plugin
 * counts as ready ONLY when its name/id matches AND it is explicitly enabled —
 * never by the mere absence of an "enabled"/"disabled"/"status" field (review
 * finding: the permissive default could report a disabled plugin as ready).
 */
const pluginListEntrySchema = z.looseObject({
  name: z.string().optional(),
  plugin: z.string().optional(),
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  marketplace: z.string().optional(),
  status: z.string().optional(),
});

const pluginListSchema = z.union([
  z.array(pluginListEntrySchema),
  z.looseObject({ plugins: z.array(pluginListEntrySchema) }),
]);

export interface PluginListState {
  /** Could we reach `claude plugin list --json` at all? */
  available: boolean;
  /** Is our plugin present and enabled? */
  installedAndEnabled: boolean;
}

/**
 * Ask Claude Code whether our plugin is installed and enabled. Returns
 * `available: false` when the CLI is missing or its output can't be parsed, so
 * doctor can fall back to reporting "can't verify" instead of a false positive.
 */
export function readPluginState(runner: CommandRunner): PluginListState {
  const result = runner.run(["plugin", "list", "--json"]);
  if (result.code !== 0 || result.stdout.trim().length === 0) {
    return { available: false, installedAndEnabled: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { available: false, installedAndEnabled: false };
  }
  const list = pluginListSchema.safeParse(parsed);
  if (!list.success) {
    return { available: false, installedAndEnabled: false };
  }
  const entries = Array.isArray(list.data) ? list.data : list.data.plugins;
  const installedAndEnabled = entries.some((entry) => {
    // Match by id, name or the plugin@marketplace ref — require a real match.
    const name = entry.id ?? entry.name ?? entry.plugin;
    if (name !== PLUGIN_NAME && name !== PLUGIN_REF) {
      return false;
    }
    // Require EXPLICIT enabled evidence. A missing enabled/disabled/status is
    // NOT treated as enabled (strict: a disabled plugin must never read ready).
    if (entry.enabled === true) {
      return true;
    }
    if (entry.disabled === false && entry.enabled !== false) {
      return true;
    }
    return entry.status === "enabled";
  });
  return { available: true, installedAndEnabled };
}
