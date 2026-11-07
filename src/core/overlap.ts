import type { ClaimRow, EditRow } from "../store/schema.js";
import { isClaimActive } from "./claims.js";
import { globMatch } from "./glob.js";

export const EDIT_OVERLAP_WINDOW_MS = 30 * 60 * 1000;

export interface OverlapConflict {
  kind: "claim" | "recent_edit";
  agentId: string;
  detail: string;
}

export interface DetectOverlapInput {
  path: string;
  agentId: string;
  now: number;
  claims: readonly ClaimRow[];
  recentEdits: readonly EditRow[];
}

export function detectOverlap(input: DetectOverlapInput): OverlapConflict[] {
  const conflicts: OverlapConflict[] = [];
  for (const claim of input.claims) {
    if (claim.agent_id === input.agentId) {
      continue;
    }
    if (!isClaimActive(claim, input.now)) {
      continue;
    }
    if (globMatch(claim.path_glob, input.path)) {
      conflicts.push({
        kind: "claim",
        agentId: claim.agent_id,
        detail: `active claim ${claim.path_glob}`,
      });
    }
  }
  const since = input.now - EDIT_OVERLAP_WINDOW_MS;
  for (const edit of input.recentEdits) {
    if (edit.agent_id === input.agentId) {
      continue;
    }
    if (edit.path !== input.path) {
      continue;
    }
    if (edit.at < since) {
      continue;
    }
    conflicts.push({
      kind: "recent_edit",
      agentId: edit.agent_id,
      detail: `edited ${edit.path} recently`,
    });
  }
  return conflicts;
}