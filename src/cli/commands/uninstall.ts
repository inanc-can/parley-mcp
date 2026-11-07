import { ADAPTERS, type AdapterEnv } from "../../adapters/index.js";

export interface UninstallDeps {
  env: AdapterEnv;
  write: (line: string) => void;
}

/**
 * `parley-mcp uninstall`: remove exactly what setup added, leaving no trace
 * (PLAN section 7 / "uninstall restores the files byte for byte").
 */
export async function runUninstall(deps: UninstallDeps): Promise<void> {
  let totalChanges = 0;
  for (const adapter of ADAPTERS) {
    const report = await adapter.uninstall(deps.env);
    totalChanges += report.changes.length;
    if (report.changes.length === 0) {
      deps.write(`- ${adapter.harness}: nothing to remove.`);
      continue;
    }
    for (const change of report.changes) {
      const verb = change.action === "create" ? "removed" : "unmerged";
      deps.write(`- ${adapter.harness}: ${verb} ${change.path}`);
    }
  }
  deps.write(totalChanges === 0 ? "Nothing to remove." : "Parley removed.");
}
