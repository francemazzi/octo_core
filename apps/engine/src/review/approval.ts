import { randomUUID } from "node:crypto";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";

export type ApprovalResult = { approved: number; total: number };

/**
 * The operator approves every valid evidence of a stopped session for `cloud_after_review`,
 * once and for good: who and when are stored on each evidence and in the audit log.
 */
export function approveSessionEvidence(
  db: Sql,
  input: { sessionId: string; at: string },
): ApprovalResult {
  const session = db
    .prepare("SELECT capture_state, operator_pseudonym FROM sessions WHERE id = ?")
    .get(input.sessionId) as { capture_state: string; operator_pseudonym: string } | undefined;
  if (!session) throw new OctoError("missing_session", input.sessionId);
  if (session.capture_state !== "stopped") {
    throw new OctoError("session_active", "stop the session before approving its evidence");
  }
  const approvedBy = `operator:${session.operator_pseudonym}`;
  db.exec("BEGIN");
  try {
    const approved = db
      .prepare(
        `UPDATE evidence SET review_state = 'approved', approved_at = ?, approved_by = ?
         WHERE session_id = ? AND availability = 'valid' AND review_state != 'approved'`,
      )
      .run(input.at, approvedBy, input.sessionId).changes;
    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total FROM evidence
         WHERE session_id = ? AND availability = 'valid' AND review_state = 'approved'`,
      )
      .get(input.sessionId) as { total: number };
    db.prepare(
      `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
       VALUES (?, ?, ?, 'evidence_approved', ?)`,
    ).run(
      randomUUID(),
      input.sessionId,
      input.at,
      JSON.stringify({ approvedBy, approved: Number(approved), total }),
    );
    db.exec("COMMIT");
    return { approved: Number(approved), total };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
