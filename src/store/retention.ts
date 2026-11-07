import type { Db } from "./db.js";
import { deleteAgreementsOlderThan } from "./repos/agreements-repo.js";
import { deleteEditsOlderThan } from "./repos/edits-repo.js";
import { deleteEventsOlderThan } from "./repos/message-events-repo.js";
import { deleteMessagesOlderThan } from "./repos/messages-repo.js";

export interface RetentionResult {
  events: number;
  messages: number;
  agreements: number;
  edits: number;
}

export function applyRetention(db: Db, cutoff: number): RetentionResult {
  // FK-safe order: events reference messages
  const run = db.transaction(() => ({
    events: deleteEventsOlderThan(db, cutoff),
    messages: deleteMessagesOlderThan(db, cutoff),
    agreements: deleteAgreementsOlderThan(db, cutoff),
    edits: deleteEditsOlderThan(db, cutoff),
  }));
  return run();
}
