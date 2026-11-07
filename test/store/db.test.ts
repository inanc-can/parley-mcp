import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrations, openDb, openMemoryDb } from "../../src/store/index.js";

describe("store db", () => {
  it("opens an in-memory db and applies numbered migrations", () => {
    const db = openMemoryDb();
    const rows = db
      .prepare("SELECT id, name FROM _migrations ORDER BY id")
      .all();
    expect(rows).toEqual(migrations.map((m) => ({ id: m.id, name: m.name })));
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("messages");
    expect(names).toContain("message_events");
    expect(names).toContain("agreements");
    expect(names).toContain("claims");
    expect(names).toContain("edits");
    expect(names).toContain("settings");
    db.close();
  });

  it("runs migrations idempotently on reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "parley-db-"));
    const path = join(dir, "hub.db");
    const db1 = openDb({ path });
    db1.close();
    const db2 = openDb({ path });
    const count = db2
      .prepare("SELECT COUNT(*) AS c FROM _migrations")
      .get() as { c: number };
    expect(count.c).toBe(migrations.length);
    db2.close();
  });
});
