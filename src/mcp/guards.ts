import { checkStopAll, type StopAllCheck } from "../core/guards.js";
import { shouldPauseAfterCount } from "../core/threads.js";
import type { Db } from "../store/db.js";
import {
  settingsRepo,
  threadsRepo,
} from "../store/index.js";
import type { ThreadRow } from "../store/schema.js";

/**
 * I/O compositions that belong to the caller layer, not the store: the store
 * reads and writes rows, core makes the pure decision, and `src/mcp` (or the
 * CLI, later) composes the two. Keeping them here means `src/store` never
 * imports `src/core`.
 */

/**
 * Production cap enforcement: counts the thread's messages and, using the pure
 * core decision, pauses the thread when it has reached its message cap. Call
 * it after inserting messages; `talk` calls into a paused thread then fail
 * with `thread_paused` via `checkThreadPostable`.
 */
export function enforceMessageCap(db: Db, threadId: string): ThreadRow {
  return db.transaction(() => {
    const thread = threadsRepo.getThread(db, threadId);
    const count = threadsRepo.countThreadMessages(db, threadId);
    if (
      thread.status === "open" &&
      shouldPauseAfterCount(count, thread.message_cap)
    ) {
      threadsRepo.setThreadStatus(db, threadId, "paused");
    }
    return threadsRepo.getThread(db, threadId);
  })();
}

/**
 * Whether `talk` is presently blocked by the human's stop-all switch. Composes
 * the stored setting with the pure core guard decision.
 */
export function checkStopAllActive(db: Db): StopAllCheck {
  return checkStopAll(settingsRepo.getStopAll(db));
}
