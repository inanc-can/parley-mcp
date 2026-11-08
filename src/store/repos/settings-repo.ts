import type { Db } from "../db.js";
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
 * Telemetry consent (PLAN M11): opt-in anonymous counts, off by default. Only
 * the flag exists. Nothing reads it to send anything, because there is no
 * server and no sending code until the human decides (see docs/telemetry.md).
 */
export function getTelemetryOptIn(db: Db): boolean {
  return getSetting(db, "telemetry_opt_in") === "true";
}

export function setTelemetryOptIn(db: Db, value: boolean): void {
  setSetting(db, "telemetry_opt_in", value ? "true" : "false");
}
