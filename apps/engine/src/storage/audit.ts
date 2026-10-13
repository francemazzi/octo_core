import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";

export type AuditEntry = {
  sessionId: string | null;
  at: string;
  action: string;
  detail: Record<string, unknown>;
};

/** One row of `audit_events`: what happened, when, for which session. */
export function recordAudit(db: Sql, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), entry.sessionId, entry.at, entry.action, JSON.stringify(entry.detail));
}
