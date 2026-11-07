import { fakeAdapter } from "./fake/index.js";
import type { Adapter, HarnessName } from "./types.js";

export * from "./types.js";

/**
 * The adapters setup/doctor iterate over. M3 ships only the fake adapter; the
 * real Claude Code / Codex / Cursor / Grok adapters are added in M4+ and slot
 * in here.
 */
export const ADAPTERS: readonly Adapter[] = [fakeAdapter];

export function findAdapter(harness: HarnessName): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.harness === harness);
}
