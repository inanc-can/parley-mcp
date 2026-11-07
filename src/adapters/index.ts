import { claudeCodeAdapter } from "./claude-code/index.js";
import { fakeAdapter } from "./fake/index.js";
import type { Adapter, HarnessName } from "./types.js";

export * from "./types.js";

/**
 * The adapters setup/doctor iterate over. The fake adapter exercises the
 * framework in tests; the Claude Code adapter (M4) is the first real harness.
 * Codex / Cursor / Grok (M5 / M8 / M9) slot in here.
 */
export const ADAPTERS: readonly Adapter[] = [claudeCodeAdapter, fakeAdapter];

export function findAdapter(harness: HarnessName): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.harness === harness);
}
