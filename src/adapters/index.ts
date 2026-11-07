import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import { cursorAdapter } from "./cursor/index.js";
import type { Adapter, HarnessName } from "./types.js";

export * from "./types.js";

/**
 * The adapters setup / uninstall / doctor iterate over in production. The fake
 * adapter is NOT here — it exists only to exercise the framework in tests
 * (import it from ./fake/index.js directly). Claude Code (M4) and Codex (M5)
 * and Cursor (M8) are wired; Grok (M9) slots in here.
 */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter, codexAdapter, cursorAdapter];

export function findAdapter(harness: HarnessName): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.harness === harness);
}
