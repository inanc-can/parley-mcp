import { describe, expect, it } from "vitest";
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
});
