import type { Db } from "../store/db.js";

/**
 * Per-server context shared by the three tools: one server process serves one
 * agent session (PLAN section 3). `repoRoot` is resolved once at startup.
 */
export interface ToolContext {
  db: Db;
  agentId: string;
  repoRoot: string;
  /** This server's session; adapters replace it with the harness's real id (M4+). */
  nativeSession: string | null;
  /** The rules file text goes out once per session: flipped on first inbox. */
  rulesTextSent: boolean;
  /**
   * Wake a recipient whose harness cannot be woken by a monitor (Codex: the
   * app-server). Injected by `mcp-parley serve`; absent in tests and when no
   * adapter provides one. Returns whether a wake was started.
   */
  wakeRecipient?: (agentId: string, harness: string) => boolean;
}
