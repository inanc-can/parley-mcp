import { ADAPTERS, type Adapter, type AdapterEnv } from "../../adapters/index.js";

export interface DoctorDeps {
  env: AdapterEnv;
  write: (line: string) => void;
  /** The adapters to iterate (defaults to the production list; tests inject). */
  adapters?: readonly Adapter[] | undefined;
}

/**
 * `mcp-parley doctor`: per-harness readiness — installed? can it wake an idle
 * session right now, and if not, why not? (PLAN section 7).
 */
export async function runDoctor(deps: DoctorDeps): Promise<void> {
  deps.write("Parley doctor:");
  for (const adapter of deps.adapters ?? ADAPTERS) {
    const report = await adapter.doctor(deps.env);
    const wake = report.canWakeIdle ? "can wake idle" : "cannot wake idle";
    const trust =
      report.hooksTrusted === undefined || report.hooksTrusted === null
        ? ""
        : report.hooksTrusted
          ? ", hooks trusted"
          : ", hooks NOT trusted";
    deps.write(
      `- ${report.harness}: ${report.installed ? "installed" : "not installed"}, ${wake}${trust} — ${report.detail}`,
    );
  }
}
