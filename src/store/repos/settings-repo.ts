import type { Db } from "../db.js";
import { checkStopAll } from "../../core/guards.js";
import type { StopAllCheck } from "../../core/guards.js";
import { parseOptionalRow } from "../parse.js";
import { settingRowSchema } from "../schema.js";

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT key, value FROM settings WHERE key = ?").get(key);
  const parsed = parseOptionalRow(settingRowSchema, row);
  return parsed?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getStopAll(db: Db): boolean {
  return getSetting(db, "stop_all") === "true";
}

export function setStopAll(db: Db, value: boolean): void {
  setSetting(db, "stop_all", value ? "true" : "false");
}

/**
 * Whether `talk` is presently blocked by the human's stop-all switch. Composes
 * the stored setting with the pure core guard decision.
 */
export function checkStopAllActive(db: Db): StopAllCheck {
  return checkStopAll(getStopAll(db));
}
