import { ADAPTERS, type AdapterEnv } from "../../adapters/index.js";

export interface DoctorDeps {
  env: AdapterEnv;
  write: (line: string) => void;
}

/**
 * `parley-mcp doctor`: per-harness readiness — installed? can it wake an idle
 * session right now, and if not, why not? (PLAN section 7).
 */
export async function runDoctor(deps: DoctorDeps): Promise<void> {
  deps.write("Parley doctor:");
  for (const adapter of ADAPTERS) {
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
