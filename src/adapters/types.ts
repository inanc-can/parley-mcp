/** The launch harnesses Parley targets, plus `fake` for the M3 framework tests. */
export type HarnessName = "claude-code" | "codex" | "cursor" | "grok" | "fake";

/** One user-level file an install created or changed, for reporting and undo. */
export interface FileChange {
  path: string;
  /** "create": the file did not exist; "merge": it existed and we merged into it. */
  action: "create" | "merge";
}

export interface DetectReport {
  installed: boolean;
  version?: string;
}

export interface InstallReport {
  harness: HarnessName;
  /** The files that were (or, in a dry run, would be) changed. */
  changes: FileChange[];
  /** True for a dry run: nothing was written. */
  dryRun: boolean;
  /**
   * Non-fatal problems the human should see — e.g. a `claude plugin …` command
   * exited non-zero. Empty on a clean run. setup/uninstall print these so a
   * failed external step is never silently reported as success (review finding).
   */
  notes?: string[];
}

export interface DoctorReport {
  harness: HarnessName;
  installed: boolean;
  /** Can this harness wake an idle session right now? */
  canWakeIdle: boolean;
  /**
   * Whether the harness has trusted Parley's hooks. `null` when the harness has
   * no such concept (e.g. Claude Code plugins/monitors don't need per-hook
   * trust) — only Codex gates new hooks behind a trust prompt (PLAN section 6).
   */
  hooksTrusted?: boolean | null;
  /** One line explaining the readiness state (why it can or cannot wake idle). */
  detail: string;
}

export interface AdapterEnv {
  /** The user's home directory (overridable in tests). */
  home: string;
}

/**
 * A harness adapter: user-level config only, idempotent, merges never
 * overwrites (PLAN section 6). M3 ships only a fake adapter; the real
 * Claude Code / Codex / Cursor / Grok adapters are M4+.
 *
 * Deviation from PLAN section 6's signature sketch: `install` takes an explicit
 * `AdapterEnv` (the HOME to target) and a `dryRun` flag, and the other methods
 * take `AdapterEnv`, so every method is pure with respect to its inputs and a
 * test can point an adapter at a temporary HOME without touching the real one.
 * PLAN's sketch wrote them as zero-arg methods; this is a testability-driven
 * widening, not a behaviour change. `HarnessName` also includes `fake` for the
 * framework tests.
 */
export interface Adapter {
  harness: HarnessName;
  detect(env: AdapterEnv): Promise<DetectReport>;
  install(env: AdapterEnv, dryRun: boolean): Promise<InstallReport>;
  uninstall(env: AdapterEnv): Promise<InstallReport>;
  doctor(env: AdapterEnv): Promise<DoctorReport>;
}
