import { describe, expect, it } from "vitest";
import { detectOverlap, EDIT_OVERLAP_WINDOW_MS } from "../../src/core/overlap.js";
import type { ClaimRow, EditRow } from "../../src/store/schema.js";

function claimRow(partial: Partial<ClaimRow> & Pick<ClaimRow, "id" | "agent_id">): ClaimRow {
  return {
    repo_root: "/repo",
    path_glob: "src/app.ts",
    expires_at: 100_000,
    released_at: null,
    ...partial,
  };
}

function editRow(partial: Partial<EditRow> & Pick<EditRow, "id" | "agent_id">): EditRow {
  return {
    repo_root: "/repo",
    path: "src/app.ts",
    at: 90_000,
    ...partial,
  };
}

describe("overlap detection", () => {
  it("detects conflict with an active claim by another agent", () => {
    const conflicts = detectOverlap({
      path: "src/app.ts",
      agentId: "b@repo",
      now: 50_000,
      claims: [claimRow({ id: "c1", agent_id: "a@repo", path_glob: "src/*.ts" })],
      recentEdits: [],
    });
    expect(conflicts).toEqual([
      { kind: "claim", agentId: "a@repo", detail: "active claim src/*.ts" },
    ]);
  });

  it("ignores own claims and inactive claims", () => {
    const conflicts = detectOverlap({
      path: "src/app.ts",
      agentId: "a@repo",
      now: 50_000,
      claims: [
        claimRow({ id: "own", agent_id: "a@repo" }),
        claimRow({ id: "expired", agent_id: "b@repo", expires_at: 1_000 }),
      ],
      recentEdits: [],
    });
    expect(conflicts).toEqual([]);
  });

  it("detects same-file edits by another agent in the last 30 minutes", () => {
    const now = 100_000;
    expect(EDIT_OVERLAP_WINDOW_MS).toBe(30 * 60 * 1000);
    const conflicts = detectOverlap({
      path: "src/app.ts",
      agentId: "b@repo",
      now,
      claims: [],
      recentEdits: [editRow({ id: "e1", agent_id: "a@repo", at: now - 60_000 })],
    });
    expect(conflicts[0]?.kind).toBe("recent_edit");
  });

  it("ignores old edits, other files, and own edits", () => {
    const now = 100_000;
    const conflicts = detectOverlap({
      path: "src/app.ts",
      agentId: "b@repo",
      now,
      claims: [],
      recentEdits: [
        editRow({ id: "old", agent_id: "a@repo", at: now - EDIT_OVERLAP_WINDOW_MS - 1 }),
        editRow({ id: "other", agent_id: "a@repo", path: "src/other.ts", at: now }),
        editRow({ id: "own", agent_id: "b@repo", at: now }),
      ],
    });
    expect(conflicts).toEqual([]);
  });
});
