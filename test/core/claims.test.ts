import { describe, expect, it } from "vitest";
import {
  CLAIM_TTL_MS,
  activeClaims,
  claimExpiresAt,
  isClaimActive,
} from "../../src/core/claims.js";
import type { ClaimRow } from "../../src/store/schema.js";

function claim(overrides: Partial<ClaimRow> & Pick<ClaimRow, "id">): ClaimRow {
  return {
    repo_root: "/repo",
    agent_id: "a@r",
    path_glob: "src/**",
    expires_at: 10_000,
    released_at: null,
    ...overrides,
  };
}

describe("claims", () => {
  it("computes a 2-hour expiry", () => {
    expect(CLAIM_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(claimExpiresAt(1_000)).toBe(1_000 + CLAIM_TTL_MS);
  });

  it("is active only when unreleased and not expired", () => {
    const now = 5_000;
    expect(isClaimActive(claim({ id: "c1", expires_at: 5_001 }), now)).toBe(true);
    expect(isClaimActive(claim({ id: "c2", expires_at: 5_000 }), now)).toBe(false);
    expect(
      isClaimActive(claim({ id: "c3", expires_at: 9_000, released_at: 4_000 }), now),
    ).toBe(false);
  });

  it("filters to active claims (expiry)", () => {
    const now = 5_000;
    const rows = [
      claim({ id: "active", expires_at: 9_000 }),
      claim({ id: "expired", expires_at: 1_000 }),
      claim({ id: "released", expires_at: 9_000, released_at: 2_000 }),
    ];
    expect(activeClaims(rows, now).map((c) => c.id)).toEqual(["active"]);
  });
});
