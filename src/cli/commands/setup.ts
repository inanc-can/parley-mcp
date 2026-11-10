import { ADAPTERS, type Adapter, type AdapterEnv } from "../../adapters/index.js";
import { cliEntryPath } from "../../adapters/cli-path.js";

export interface SetupDeps {
  env: AdapterEnv;
  write: (line: string) => void;
  harness?: string | undefined;
  dryRun?: boolean | undefined;
  /** The adapters to iterate (defaults to the production list; tests inject). */
  adapters?: readonly Adapter[] | undefined;
  /** The CLI entry the launcher will point at (defaults to this install's). */
  entryPath?: string | undefined;
}

/**
 * True when this CLI runs from npx's cache. npm keeps that cache until it is
 * cleared, but clearing it is routine (`npm cache npx rm` in npm 11, or
 * deleting ~/.npm/_npx), and every config setup writes points at the
 * launcher, which points at this entry: verified on 2026-11-10, clearing it
 * made such a launcher fail with MODULE_NOT_FOUND.
 */
export function runningFromNpxCache(entryPath: string): boolean {
  return /[\\/]_npx[\\/]/.test(entryPath);
}

export const NPX_REFUSAL = [
  "mcp-parley is running from npx's cache, which is meant to be thrown away (`npm cache npx rm`,",
  "or deleting ~/.npm/_npx, clears it); every config setup writes would then point at a missing",
  "file. Install it once instead:",
  "",
  "  npm install -g mcp-parley && mcp-parley setup",
];

/**
 * `mcp-parley setup [--harness <name>] [--dry-run]`: detect harnesses, install
 * their adapters (user-level config only, idempotent, merges never overwrite),
 * and print exactly which files changed. `--dry-run` changes nothing
 * (PLAN section 7). Running setup twice changes nothing the second time.
 */
export async function runSetup(deps: SetupDeps): Promise<void> {
  const dryRun = deps.dryRun ?? false;
  if (!dryRun && runningFromNpxCache(deps.entryPath ?? cliEntryPath())) {
    for (const line of NPX_REFUSAL) {
      deps.write(line);
    }
    return;
  }
  const all = deps.adapters ?? ADAPTERS;
  const adapters = selectAdapters(all, deps.harness);
  if (adapters.length === 0) {
    deps.write(`No adapter for harness '${deps.harness ?? ""}'.`);
    return;
  }
  deps.write(dryRun ? "Dry run — no files will be changed." : "Setting up Parley.");
  let totalChanges = 0;
  for (const adapter of adapters) {
    const detected = await adapter.detect(deps.env);
    if (!detected.installed) {
      deps.write(`- ${adapter.harness}: not installed, skipped.`);
      continue;
    }
    const report = await adapter.install(deps.env, dryRun);
    totalChanges += report.changes.length;
    if (report.changes.length === 0) {
      deps.write(`- ${adapter.harness}: already set up, nothing to change.`);
    } else {
      for (const change of report.changes) {
        const verb = dryRun ? "would" : "did";
        deps.write(`- ${adapter.harness}: ${verb} ${change.action} ${change.path}`);
      }
    }
    for (const note of report.notes ?? []) {
      deps.write(`  ! ${adapter.harness}: ${note}`);
    }
  }
  if (totalChanges === 0) {
    deps.write("Nothing to change.");
  }
  if (!dryRun && totalChanges > 0) {
    deps.write('Try typing to one of your agents, e.g. "say hi to claude@<folder>".');
  }
}

function selectAdapters(all: readonly Adapter[], harness: string | undefined): readonly Adapter[] {
  if (harness === undefined) {
    return all;
  }
  return all.filter((adapter) => adapter.harness === harness);
}
