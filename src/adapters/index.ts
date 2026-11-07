import { claudeCodeAdapter } from "./claude-code/index.js";
import type { Adapter, HarnessName } from "./types.js";

export * from "./types.js";

/**
 * The adapters setup / uninstall / doctor iterate over in production. The fake
 * adapter is NOT here — it exists only to exercise the framework in tests
 * (import it from ./fake/index.js directly). Claude Code (M4) is the first real
 * harness; Codex / Cursor / Grok (M5 / M8 / M9) slot in here.
 */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter];

export function findAdapter(harness: HarnessName): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.harness === harness);
}
