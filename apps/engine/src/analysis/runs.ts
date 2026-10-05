import { randomUUID } from "node:crypto";
import type { Sql } from "../storage/db.js";
import type { DataMode } from "./policy.js";

export type RunOutcome = "accepted" | "rejected" | "error" | "unavailable";

export type RunRecord = {
  sessionId: string;
  mode: DataMode;
  model: string;
  provider: string;
  promptSchema: string;
  outcome: RunOutcome;
  at: string;
  detail: Record<string, unknown>;
  usage?: Record<string, number>;
};

export type LatestRun = {
  outcome: string;
  model: string;
  provider: string;
  error: string | null;
  /** Some evidence of the session was never sent to the model. */
  partial: boolean;
};

/** Every model call, whatever its outcome: model, provider, prompt schema, input and usage. */
export function recordRun(db: Sql, run: RunRecord): void {
  db.prepare(
    `INSERT INTO analysis_runs (
      id, session_id, model, provider, prompt_schema, evidence_json, outcome, usage_json, data_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    run.sessionId,
    run.model,
    run.provider,
    run.promptSchema,
    JSON.stringify({ at: run.at, ...run.detail }),
    run.outcome,
    JSON.stringify(run.usage ?? {}),
    run.mode,
  );
}

/** The last recorded call for the session, or the last accepted one. */
export function latestRun(
  db: Sql,
  sessionId: string,
  options: { accepted?: boolean } = {},
): LatestRun | undefined {
  const row = db
    .prepare(
      `SELECT outcome, model, provider, json_extract(evidence_json, '$.error') AS error,
         COALESCE(json_extract(evidence_json, '$.evidenceSent')
           < json_extract(evidence_json, '$.evidenceTotal'), 0) AS partial
       FROM analysis_runs
       WHERE session_id = ? AND (? = 0 OR outcome = 'accepted')
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(sessionId, options.accepted ? 1 : 0) as
    | { outcome: string; model: string; provider: string; error: string | null; partial: number }
    | undefined;
  return row ? { ...row, partial: row.partial === 1 } : undefined;
}
