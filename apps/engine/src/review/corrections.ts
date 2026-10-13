import { randomUUID } from "node:crypto";
import type { Sql } from "../storage/db.js";

/** Operator corrections of a project: kept with their revocation, never exported for training. */
export function projectCorrections(db: Sql, projectId: string, nowWall: () => string) {
  return {
    add(note: string) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO corrections (id, project_id, episode_id, note, revoked_at) VALUES (?, ?, NULL, ?, NULL)`,
      ).run(id, projectId, note);
      return id;
    },
    revoke(id: string) {
      db.prepare("UPDATE corrections SET revoked_at = ? WHERE id = ?").run(nowWall(), id);
    },
    active() {
      return db
        .prepare("SELECT * FROM corrections WHERE project_id = ? AND revoked_at IS NULL")
        .all(projectId);
    },
    trainingExport() {
      return [] as unknown[];
    },
  };
}
