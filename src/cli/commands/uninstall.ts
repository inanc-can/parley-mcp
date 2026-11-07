import { ADAPTERS, type Adapter, type AdapterEnv } from "../../adapters/index.js";

export interface UninstallDeps {
  env: AdapterEnv;
  write: (line: string) => void;
  /** The adapters to iterate (defaults to the production list; tests inject). */
  adapters?: readonly Adapter[] | undefined;
}

/**
 * `mcp-parley uninstall`: remove exactly what setup added, leaving no trace
 * (PLAN section 7 / "uninstall restores the files byte for byte").
 */
export async function runUninstall(deps: UninstallDeps): Promise<void> {
  let totalChanges = 0;
  for (const adapter of deps.adapters ?? ADAPTERS) {
    const report = await adapter.uninstall(deps.env);
    totalChanges += report.changes.length;
    if (report.changes.length === 0) {
      deps.write(`- ${adapter.harness}: nothing to remove.`);
    } else {
      for (const change of report.changes) {
        const verb = change.action === "create" ? "removed" : "unmerged";
        deps.write(`- ${adapter.harness}: ${verb} ${change.path}`);
      }
    }
    for (const note of report.notes ?? []) {
      deps.write(`  ! ${adapter.harness}: ${note}`);
    }
  }
  deps.write(totalChanges === 0 ? "Nothing to remove." : "Parley removed.");
}
