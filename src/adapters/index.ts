import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import { cursorAdapter } from "./cursor/index.js";
import { grokAdapter } from "./grok/index.js";
import type { Adapter, HarnessName } from "./types.js";

export * from "./types.js";

/**
 * The adapters setup / uninstall / doctor iterate over in production. The fake
 * adapter is NOT here — it exists only to exercise the framework in tests
 * (import it from ./fake/index.js directly). Claude Code (M4) and Codex (M5)
 * Cursor (M8) and Grok Build (M9) are wired.
 */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter, codexAdapter, cursorAdapter, grokAdapter];

export function findAdapter(harness: HarnessName): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.harness === harness);
}
