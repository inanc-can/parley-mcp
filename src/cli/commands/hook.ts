import { randomUUID } from "node:crypto";
import { detectOverlap, EDIT_OVERLAP_WINDOW_MS } from "../../core/overlap.js";
import { claimsRepo, editsRepo, type Db } from "../../store/index.js";

export interface HookEditDeps {
  db: Db;
  repoRoot: string;
  /** Diagnostic lines (stderr for Claude hooks; see HookEventDeps.status). */
  status: (line: string) => void;
  now?: number;
}

/**
 * `mcp-parley hook edit --agent <id> --path <path>`: used by post-edit hooks.
 * Records the edit, then warns (never blocks, PLAN 4.5) about overlap with
 * other agents' active claims and their edits of the same file in the last
 * 30 minutes. Returns the number of conflicts found.
 */
export function runHookEdit(deps: HookEditDeps, agentId: string, path: string): number {
  const now = deps.now ?? Date.now();
  editsRepo.insertEdit(deps.db, {
    id: randomUUID(),
    repoRoot: deps.repoRoot,
    agentId,
    path,
    at: now,
  });
  const claims = claimsRepo.listActiveClaims(deps.db, deps.repoRoot, now);
  const recentEdits = editsRepo.listRecentEditsForPath(
    deps.db,
    deps.repoRoot,
    path,
    now - EDIT_OVERLAP_WINDOW_MS,
  );
  const conflicts = detectOverlap({
    path,
    agentId,
    now,
    claims,
    recentEdits,
  });
  if (conflicts.length === 0) {
    deps.status(`edit recorded: ${agentId} ${path} (no overlap)`);
    return 0;
  }
  deps.status(`edit recorded: ${agentId} ${path} — overlap warning:`);
  for (const conflict of conflicts) {
    deps.status(`  ${conflict.agentId} (${conflict.kind}): ${conflict.detail}`);
  }
  return conflicts.length;
}
