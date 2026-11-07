import Database from "better-sqlite3";
import { z } from "zod";
import { migrations } from "./migrations.js";

export type Db = Database.Database;

export interface OpenDbOptions {
  path: string;
  busyTimeoutMs?: number;
}

export function openDb(options: OpenDbOptions): Db {
  const db = new Database(options.path);
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${String(options.busyTimeoutMs ?? 5000)}`);
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function openMemoryDb(): Db {
  return openDb({ path: ":memory:" });
}

const migrationIdRow = z.object({ id: z.number().int() });

function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set<number>();
  const rows = db.prepare("SELECT id FROM _migrations").all();
  for (const row of rows) {
    const parsed = migrationIdRow.safeParse(row);
    if (parsed.success) {
      applied.add(parsed.data.id);
    }
  }
  const insert = db.prepare(
    "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)",
  );
  const applyAll = db.transaction(() => {
    for (const migration of migrations) {
      if (!applied.has(migration.id)) {
        db.exec(migration.sql);
        insert.run(migration.id, migration.name, Date.now());
      }
    }
  });
  applyAll();
}
