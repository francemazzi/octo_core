import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type Sql = DatabaseSync;

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001") as
    { id: string } | undefined;
  if (!applied) {
    const sql = readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        "001",
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}
