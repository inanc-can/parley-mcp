import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { claimExpiresAt } from "../../src/core/claims.js";
import { claimsRepo, openMemoryDb } from "../../src/store/index.js";

describe("claims store", () => {
  it("expires claims and supports renew/release", () => {
    const db = openMemoryDb();
    const now = 10_000;
    const id = randomUUID();
    claimsRepo.insertClaim(db, {
      id,
      repoRoot: "/repo",
      agentId: "a@r",
      pathGlob: "src/**",
      expiresAt: claimExpiresAt(now),
    });
    expect(claimsRepo.listActiveClaims(db, "/repo", now)).toHaveLength(1);
    // expired
    expect(claimsRepo.listActiveClaims(db, "/repo", now + 2 * 60 * 60 * 1000 + 1)).toHaveLength(0);

    // renew extends
    expect(claimsRepo.renewClaim(db, id, now + 10 * 60 * 60 * 1000)).toBe(true);
    expect(claimsRepo.listActiveClaims(db, "/repo", now + 3 * 60 * 60 * 1000)).toHaveLength(1);

    // release
    expect(claimsRepo.releaseClaim(db, id, now + 1)).toBe(true);
    expect(claimsRepo.listActiveClaims(db, "/repo", now + 1)).toHaveLength(0);
    expect(claimsRepo.renewClaim(db, id, now + 99_999)).toBe(false);
    db.close();
  });
});
