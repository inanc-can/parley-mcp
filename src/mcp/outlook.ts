/**
 * One honest sentence about what will happen to a message, built from what
 * the hub can actually see (PLAN section 5): the recipient's heartbeat
 * presence. Until harness adapters exist (M4+) there is no wake mechanism,
 * so the wording says when the recipient will look, never that it has.
 */
export function buildOutlook(
  recipientId: string,
  recipient: { lastHeartbeat: number | null } | undefined,
  now: number,
): string {
  if (recipient === undefined) {
    return (
      `${recipientId} has never checked in; the message is queued until ` +
      `it does, expires in 24 h.`
    );
  }
  const seconds = Math.round((now - (recipient.lastHeartbeat ?? 0)) / 1000);
  if (seconds <= 30) {
    return `${recipientId} is active right now; it should see this at its next tool call.`;
  }
  return (
    `${recipientId} was last seen ${String(seconds)} s ago and is idle; ` +
    `queued until its next check, expires in 24 h.`
  );
}

export function pluralOutlook(
  recipients: readonly string[],
  outlooks: readonly string[],
): string {
  if (recipients.length === 1) {
    return outlooks[0] ?? "";
  }
  return `Sent to ${String(recipients.length)} agents. ` + outlooks.join(" ");
}
