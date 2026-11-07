import { describe, expect, it } from "vitest";
import { checkStopAll } from "../../src/core/guards.js";
import { openMemoryDb, settingsRepo } from "../../src/store/index.js";

describe("stop_all setting", () => {
  it("defaults to off and toggles like a viewer switch", () => {
    const db = openMemoryDb();
    expect(settingsRepo.getStopAll(db)).toBe(false);
    settingsRepo.setStopAll(db, true);
    expect(settingsRepo.getStopAll(db)).toBe(true);
    settingsRepo.setStopAll(db, false);
    expect(settingsRepo.getStopAll(db)).toBe(false);
    db.close();
  });

  it("composes with the stop-all guard: talk blocked until human turns it off", () => {
    const db = openMemoryDb();
    expect(settingsRepo.checkStopAllActive(db)).toEqual({ ok: true });

    settingsRepo.setStopAll(db, true);
    expect(settingsRepo.checkStopAllActive(db)).toEqual({
      ok: false,
      code: "stop_all",
    });

    // The human resumes from the viewer.
    settingsRepo.setStopAll(db, false);
    expect(settingsRepo.checkStopAllActive(db)).toEqual({ ok: true });
    expect(checkStopAll(settingsRepo.getStopAll(db))).toEqual({ ok: true });
    db.close();
  });
});
