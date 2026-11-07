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
}
