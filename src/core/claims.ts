import type { ClaimRow } from "../store/schema.js";

export const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

export function claimExpiresAt(now: number): number {
  return now + CLAIM_TTL_MS;
}

export function isClaimActive(claim: ClaimRow, now: number): boolean {
  return claim.released_at === null && claim.expires_at > now;
}

export function activeClaims(claims: readonly ClaimRow[], now: number): ClaimRow[] {
  return claims.filter((claim) => isClaimActive(claim, now));
}
