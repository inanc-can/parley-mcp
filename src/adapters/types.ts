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
}

export interface DoctorReport {
  harness: HarnessName;
  installed: boolean;
  /** Can this harness wake an idle session right now? */
  canWakeIdle: boolean;
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
 */
export interface Adapter {
  harness: HarnessName;
  detect(env: AdapterEnv): Promise<DetectReport>;
  install(env: AdapterEnv, dryRun: boolean): Promise<InstallReport>;
  uninstall(env: AdapterEnv): Promise<InstallReport>;
  doctor(env: AdapterEnv): Promise<DoctorReport>;
}
