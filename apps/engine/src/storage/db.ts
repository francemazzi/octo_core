import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type Sql = DatabaseSync;

/** Applied in order, each once; the packaged engine inlines every file listed here. */
const MIGRATIONS = [
  ["001", "001_init.sql"],
  ["002", "002_episode_labels.sql"],
] as const;

function migrationSql(file: string): string {
  return readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8");
}

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  for (const [id, name] of MIGRATIONS) {
    const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(id) as
      { id: string } | undefined;
    if (applied) continue;
    const sql = migrationSql(name);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        id,
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
