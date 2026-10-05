import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";

describe("database migrations", () => {
  it("upgrades a database created before 002 and applies each migration once", () => {
    const file = join(mkdtempSync(join(tmpdir(), "octo-db-")), "octo.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    old.exec(readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8"));
    old.exec("INSERT INTO schema_migrations VALUES ('001', '2026-01-01T00:00:00.000Z')");
    old.exec(
      `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
       VALUES ('p', 'demo', 'local_only', '{}', '{}', '2026-01-01T00:00:00.000Z')`,
    );
    old.exec(
      `INSERT INTO sessions (id, project_id, operator_pseudonym, started_wall, capture_state,
         analysis_state, scope_json, policy_version, epoch_id)
       VALUES ('s', 'p', 'op', '2026-01-01T00:00:00.000Z', 'stopped', 'idle', '[]', 'mvp-1', 'e')`,
    );
    old.close();

    const upgraded = openDatabase(file);
    expect(upgraded.prepare("SELECT id, title FROM sessions").all()).toEqual([
      { id: "s", title: null },
    ]);
    upgraded.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toEqual([
      { id: "001" },
      { id: "002" },
      { id: "003" },
    ]);
    const columns = (table: string) =>
      (reopened.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
    expect(columns("episodes")).toEqual(expect.arrayContaining(["label", "summary"]));
    expect(columns("evidence")).toEqual(expect.arrayContaining(["approved_at", "approved_by"]));
    reopened.close();
  });
});
