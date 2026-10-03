import { randomUUID } from "node:crypto";
import type { ModelOutput } from "@octo/contracts";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";
import type { AnalysisProfile, ModelAdapter, ModelEvidence } from "./model-adapter.js";
import { acceptModelOutput, evidenceIdsForMode, type DataMode } from "./policy.js";

const MAX_EVIDENCE = 200;
const MAX_TEXT_CHARS = 500;

export type InterpretReason =
  | "accepted"
  | "model_unavailable"
  | "remote_unavailable"
  | "no_evidence"
  | "model_error"
  | "unusable_output";

export type InterpretResult = {
  output: ModelOutput | null;
  model: string | null;
  reason: InterpretReason;
};

export type InterpretDeps = {
  db: Sql;
  profile: AnalysisProfile;
  readText: (assetId: string) => string;
  nowWall: () => string;
};

type EvidenceRow = {
  id: string;
  source_id: string;
  start_ms: number;
  asset_id: string | null;
  review_state: string;
};

type RunRecord = {
  sessionId: string;
  mode: DataMode;
  model: string;
  outcome: "accepted" | "rejected" | "error" | "unavailable";
  detail: Record<string, unknown>;
  usage?: Record<string, number>;
};

export function adapterFor(profile: AnalysisProfile, mode: DataMode): ModelAdapter | undefined {
  return mode === "local_only" ? profile.models.local : profile.models.remote;
}

export async function interpretSession(
  deps: InterpretDeps,
  input: { sessionId: string; mode: DataMode; windowMs: number },
): Promise<InterpretResult> {
  const adapter = adapterFor(deps.profile, input.mode);
  if (!adapter) {
    const reason = input.mode === "local_only" ? "model_unavailable" : "remote_unavailable";
    return { output: null, model: null, reason };
  }
  const rows = deps.db
    .prepare(
      `SELECT id, source_id, start_ms, asset_id, review_state FROM evidence
       WHERE session_id = ? AND availability = 'valid' ORDER BY start_ms, id`,
    )
    .all(input.sessionId) as EvidenceRow[];
  const perimeter = new Set(
    adapter.locality === "remote"
      ? evidenceIdsForMode(
          input.mode,
          input.sessionId,
          rows.map((row) => ({
            id: row.id,
            reviewState: row.review_state,
            sessionId: input.sessionId,
          })),
        )
      : rows.map((row) => row.id),
  );
  const selected = rows.filter((row) => perimeter.has(row.id)).slice(0, MAX_EVIDENCE);
  if (selected.length === 0) return { output: null, model: null, reason: "no_evidence" };
  const ids = selected.map((row) => row.id);
  if (adapter.locality === "remote") {
    deps.db
      .prepare(
        `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
         VALUES (?, ?, ?, 'network', ?)`,
      )
      .run(
        randomUUID(),
        input.sessionId,
        deps.nowWall(),
        JSON.stringify({ evidenceIds: ids, provider: adapter.provider }),
      );
  }
  const evidence: ModelEvidence[] = selected.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    startMs: row.start_ms,
    text: row.asset_id ? deps.readText(row.asset_id).slice(0, MAX_TEXT_CHARS) : "",
  }));
  const base = { sessionId: input.sessionId, mode: input.mode };

  let reply;
  try {
    reply = await adapter.interpret(evidence);
  } catch (error) {
    const unavailable = error instanceof OctoError && error.code === "model_unavailable";
    const code = error instanceof OctoError ? error.code : "internal";
    const message = error instanceof Error ? error.message.slice(0, 200) : "";
    recordRun(deps, adapter, {
      ...base,
      model: "unknown",
      outcome: unavailable ? "unavailable" : "error",
      detail: { input: ids, error: code, message },
    });
    return { output: null, model: null, reason: unavailable ? "model_unavailable" : "model_error" };
  }

  try {
    const output = acceptModelOutput(reply.raw, new Set(ids), input.windowMs);
    recordRun(deps, adapter, {
      ...base,
      model: reply.model,
      outcome: "accepted",
      detail: { input: ids, episodes: output.episodes, questions: output.questions ?? [] },
      usage: reply.usage,
    });
    return { output, model: reply.model, reason: "accepted" };
  } catch (error) {
    if (!(error instanceof OctoError)) throw error;
    recordRun(deps, adapter, {
      ...base,
      model: reply.model,
      outcome: "rejected",
      detail: { input: ids, error: error.code },
      usage: reply.usage,
    });
    return { output: null, model: reply.model, reason: "unusable_output" };
  }
}

function recordRun(deps: InterpretDeps, adapter: ModelAdapter, run: RunRecord): void {
  deps.db
    .prepare(
      `INSERT INTO analysis_runs (
        id, session_id, model, provider, prompt_schema, evidence_json, outcome, usage_json, data_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      run.sessionId,
      run.model,
      adapter.provider,
      adapter.promptSchema,
      JSON.stringify({ at: deps.nowWall(), ...run.detail }),
      run.outcome,
      JSON.stringify(run.usage ?? {}),
      run.mode,
    );
}
