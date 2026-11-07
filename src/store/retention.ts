import type { Db } from "./db.js";
import { deleteAgreementsOlderThan } from "./repos/agreements-repo.js";
import { deleteEditsOlderThan } from "./repos/edits-repo.js";
import { deleteEventsOfMessagesSentBefore } from "./repos/message-events-repo.js";
import { deleteMessagesOlderThan } from "./repos/messages-repo.js";

export interface RetentionResult {
  events: number;
  messages: number;
  agreements: number;
  edits: number;
}

export function applyRetention(db: Db, cutoff: number): RetentionResult {
  // FK-safe order: events reference messages. Events are deleted for the
  // messages being removed (all of their events, regardless of event time),
  // keyed on messages.sent_at.
  const run = db.transaction(() => ({
    events: deleteEventsOfMessagesSentBefore(db, cutoff),
    messages: deleteMessagesOlderThan(db, cutoff),
    agreements: deleteAgreementsOlderThan(db, cutoff),
    edits: deleteEditsOlderThan(db, cutoff),
  }));
  return run();
}
