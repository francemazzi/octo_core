import { randomUUID } from "node:crypto";
import { MAX_ANALYSIS_BATCHES, MAX_BATCH_EVIDENCE, type ModelOutput } from "@octo/contracts";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";
import { knownActivities, mergeOutputs, planBatches, textCharsFor } from "./batches.js";
import type {
  AnalysisProfile,
  KnownActivity,
  ModelAdapter,
  ModelEvidence,
  ModelReply,
} from "./model-adapter.js";
import { acceptModelOutput, evidenceIdsForMode, type DataMode } from "./policy.js";
import { recordRun, type RunOutcome } from "./runs.js";

/** A rejected reply gets one more try, unless the first call was already slow. */
const RETRY_WITHIN_MS = 60_000;
/** A remote model that dropped the connection or was busy gets one more try in any case. */
const RETRY_ALWAYS = new Set(["remote_unreachable"]);
const RETRYABLE = new Set([
  "empty_output",
  "unknown_evidence",
  "duplicate_evidence",
  "invalid_model_output",
]);

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

type Input = { sessionId: string; mode: DataMode; windowMs: number };

/** How much of the session one analysis sends, recorded with each of its model calls. */
type Coverage = {
  analysisId: string;
  evidenceTotal: number;
  evidenceSent: number;
  batches: number;
};

type Call = {
  deps: InterpretDeps;
  adapter: ModelAdapter;
  input: Input;
  coverage: Coverage;
  index: number;
  evidence: ModelEvidence[];
  known: KnownActivity[];
};

type CallResult = InterpretResult & { code?: string };

export function adapterFor(profile: AnalysisProfile, mode: DataMode): ModelAdapter | undefined {
  return mode === "local_only" ? profile.models.local : profile.models.remote;
}

/**
 * Sends the session to the model in batches, in time order; each batch sees the activities of
 * the earlier ones and may continue them. A batch the model leaves empty keeps its time
 * `unknown`; any other failed batch stops the analysis.
 */
export async function interpretSession(
  deps: InterpretDeps,
  input: Input,
): Promise<InterpretResult> {
  const adapter = adapterFor(deps.profile, input.mode);
  if (!adapter) {
    const reason = input.mode === "local_only" ? "model_unavailable" : "remote_unavailable";
    return { output: null, model: null, reason };
  }
  const rows = perimeterEvidence(deps.db, adapter, input);
  if (rows.length === 0) return { output: null, model: null, reason: "no_evidence" };
  const plan = planBatches(rows, MAX_BATCH_EVIDENCE, MAX_ANALYSIS_BATCHES);
  const coverage: Coverage = {
    analysisId: randomUUID(),
    evidenceTotal: plan.evidenceTotal,
    evidenceSent: plan.evidenceSent,
    batches: plan.batches.length,
  };
  const outputs: ModelOutput[] = [];
  let model: string | null = null;
  for (const [index, batch] of plan.batches.entries()) {
    const known = outputs.length > 0 ? knownActivities(mergeOutputs(outputs)) : [];
    const evidence = toEvidence(deps, batch, known);
    const result = await callWithRetry({ deps, adapter, input, coverage, index, evidence, known });
    model = result.model ?? model;
    if (result.output) outputs.push(result.output);
    else if (result.code !== "empty_output") {
      return { output: null, model: result.model, reason: result.reason };
    }
  }
  if (outputs.length === 0) return { output: null, model, reason: "unusable_output" };
  const sent = new Set(plan.batches.flat().map((row) => row.id));
  return {
    output: acceptModelOutput(mergeOutputs(outputs), sent, input.windowMs),
    model,
    reason: "accepted",
  };
}

/** Valid evidence of the session that the mode allows to reach this adapter, in time order. */
function perimeterEvidence(db: Sql, adapter: ModelAdapter, input: Input): EvidenceRow[] {
  const rows = db
    .prepare(
      `SELECT id, source_id, start_ms, asset_id, review_state FROM evidence
       WHERE session_id = ? AND availability = 'valid' ORDER BY start_ms, id`,
    )
    .all(input.sessionId) as EvidenceRow[];
  if (adapter.locality === "local") return rows;
  const allowed = new Set(
    evidenceIdsForMode(
      input.mode,
      input.sessionId,
      rows.map((row) => ({
        id: row.id,
        reviewState: row.review_state,
        sessionId: input.sessionId,
      })),
    ),
  );
  return rows.filter((row) => allowed.has(row.id));
}

function toEvidence(
  deps: InterpretDeps,
  batch: EvidenceRow[],
  known: KnownActivity[],
): ModelEvidence[] {
  const reserved = known.reduce(
    (sum, activity) => sum + activity.activityType.length + (activity.label?.length ?? 0) + 40,
    0,
  );
  const textChars = textCharsFor(batch.length, reserved);
  return batch.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    startMs: row.start_ms,
    text: row.asset_id ? deps.readText(row.asset_id).slice(0, textChars) : "",
  }));
}

async function callWithRetry(call: Call): Promise<CallResult> {
  const startedAt = Date.now();
  const first = await attempt(call);
  const retry =
    first.code !== undefined &&
    (RETRY_ALWAYS.has(first.code) ||
      (RETRYABLE.has(first.code) && Date.now() - startedAt < RETRY_WITHIN_MS));
  return retry ? attempt(call) : first;
}

/** One call to the model, validated and recorded in `analysis_runs` whatever the outcome. */
async function attempt(call: Call): Promise<CallResult> {
  const { deps, adapter, input, coverage } = call;
  const ids = call.evidence.map((item) => item.id);
  const detail = {
    analysisId: coverage.analysisId,
    batch: { index: call.index, count: coverage.batches },
    evidenceTotal: coverage.evidenceTotal,
    evidenceSent: coverage.evidenceSent,
    input: ids,
  };
  const record = (
    outcome: RunOutcome,
    model: string,
    extra: Record<string, unknown>,
    usage?: Record<string, number>,
  ) =>
    recordRun(deps.db, {
      sessionId: input.sessionId,
      mode: input.mode,
      model,
      provider: adapter.provider,
      promptSchema: adapter.promptSchema,
      outcome,
      at: deps.nowWall(),
      detail: { ...detail, ...extra },
      usage,
    });
  if (adapter.locality === "remote") auditNetwork(deps, input.sessionId, ids, adapter.provider);

  let reply: ModelReply;
  try {
    reply = await adapter.interpret(call.evidence, call.known);
  } catch (error) {
    const unavailable = error instanceof OctoError && error.code === "model_unavailable";
    const code = error instanceof OctoError ? error.code : "internal";
    const message = error instanceof Error ? error.message.slice(0, 200) : "";
    record(unavailable ? "unavailable" : "error", "unknown", { error: code, message });
    const reason = unavailable ? "model_unavailable" : "model_error";
    return { output: null, model: null, reason, code };
  }

  try {
    assertNoIssues(reply);
    const prior = new Set(call.known.map((activity) => activity.episodeId));
    const output = acceptModelOutput(reply.raw, new Set(ids), input.windowMs, prior);
    record(
      "accepted",
      reply.model,
      {
        title: output.title ?? null,
        episodes: output.episodes,
        questions: output.questions ?? [],
        ...(reply.issues?.orphanQuestions.length ? { issues: reply.issues } : {}),
      },
      reply.usage,
    );
    return { output, model: reply.model, reason: "accepted" };
  } catch (error) {
    if (!(error instanceof OctoError)) throw error;
    record(
      "rejected",
      reply.model,
      { error: error.code, ...(reply.issues ? { issues: reply.issues } : {}) },
      reply.usage,
    );
    return { output: null, model: reply.model, reason: "unusable_output", code: error.code };
  }
}

/** Evidence the model invented or put in two activities makes the whole reply untrustworthy. */
function assertNoIssues(reply: ModelReply): void {
  const issues = reply.issues;
  if (issues?.unknownEvidence.length) {
    throw new OctoError("unknown_evidence", issues.unknownEvidence.slice(0, 5).join(", "));
  }
  if (issues?.duplicateEvidence.length) {
    throw new OctoError("duplicate_evidence", issues.duplicateEvidence.slice(0, 5).join(", "));
  }
}

/** Written before each remote call: what leaves the computer, and to whom. */
function auditNetwork(deps: InterpretDeps, sessionId: string, ids: string[], provider: string) {
  deps.db
    .prepare(
      `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
       VALUES (?, ?, ?, 'network', ?)`,
    )
    .run(randomUUID(), sessionId, deps.nowWall(), JSON.stringify({ evidenceIds: ids, provider }));
}
