import { describe, expect, it } from "vitest";
import {
  canAnswerAgreement,
  nextAgreementStatus,
} from "../../src/core/agreements.js";

describe("agreements", () => {
  it("moves offered agreements by the responder's action", () => {
    expect(nextAgreementStatus("accept")).toBe("accepted");
    expect(nextAgreementStatus("counter")).toBe("countered");
    expect(nextAgreementStatus("reject")).toBe("rejected");
    expect(nextAgreementStatus("veto")).toBe("vetoed");
  });

  it("lets only the recipient answer an offered agreement", () => {
    expect(canAnswerAgreement("offered", "b@r", "b@r")).toBe(true);
    expect(canAnswerAgreement("offered", "b@r", "c@r")).toBe(false);
  });

  it("rejects answers once the agreement is no longer offered", () => {
    for (const status of ["accepted", "countered", "rejected", "vetoed"] as const) {
      expect(canAnswerAgreement(status, "b@r", "b@r")).toBe(false);
    }
  });
});
