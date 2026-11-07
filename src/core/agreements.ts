import type { AgreementStatus } from "../store/schema.js";

export function canAnswerAgreement(
  status: AgreementStatus,
  responderId: string,
  recipientId: string,
): boolean {
  if (status !== "offered") {
    return false;
  }
  return responderId === recipientId;
}

export function nextAgreementStatus(
  action: "accept" | "counter" | "reject" | "veto",
): AgreementStatus {
  if (action === "accept") {
    return "accepted";
  }
  if (action === "counter") {
    return "countered";
  }
  if (action === "reject") {
    return "rejected";
  }
  return "vetoed";
}
