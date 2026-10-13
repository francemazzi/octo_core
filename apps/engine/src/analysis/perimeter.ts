import { recordAudit } from "../storage/audit.js";
import type { Sql } from "../storage/db.js";
import { textCharsFor } from "./batches.js";
import type { KnownActivity, ModelAdapter, ModelEvidence } from "./model-adapter.js";
import { evidenceIdsForMode, type DataMode } from "./policy.js";

/** What the analysis and the session assistant share: which evidence a model may see. */
export type PerimeterDeps = {
  db: Sql;
  readText: (assetId: string) => string;
  nowWall: () => string;
};

export type EvidenceRow = {
  id: string;
  source_id: string;
  start_ms: number;
  asset_id: string | null;
  review_state: string;
};

/** Valid evidence of the session that the mode allows to reach this adapter, in time order. */
export function perimeterEvidence(
  db: Sql,
  adapter: ModelAdapter,
  input: { sessionId: string; mode: DataMode },
): EvidenceRow[] {
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

export type ReadableEvidence = {
  rows: EvidenceRow[];
  readText: (assetId: string) => string;
  unreadable: number;
};

/**
 * Evidence whose text can still be read. Screenshots kept by Octo 1.2 and earlier were encrypted
 * with a key that did not survive a restart: they are left out and counted, never sent.
 */
export function readableEvidence(
  readText: (assetId: string) => string,
  rows: EvidenceRow[],
): ReadableEvidence {
  const texts = new Map<string, string>();
  const readable = rows.filter((row) => {
    if (!row.asset_id) return true;
    try {
      texts.set(row.asset_id, readText(row.asset_id));
      return true;
    } catch {
      return false;
    }
  });
  return {
    rows: readable,
    readText: (assetId) => texts.get(assetId) ?? "",
    unreadable: rows.length - readable.length,
  };
}

/** Prompt characters the activities of earlier batches take before the screen text. */
export function reservedByActivities(known: readonly KnownActivity[]): number {
  return known.reduce(
    (sum, activity) => sum + activity.activityType.length + (activity.label?.length ?? 0) + 40,
    0,
  );
}

/** The screen text of a batch, cut to the share of the prompt budget left by `reservedChars`. */
export function toEvidence(
  deps: PerimeterDeps,
  batch: EvidenceRow[],
  reservedChars = 0,
): ModelEvidence[] {
  const textChars = textCharsFor(Math.max(1, batch.length), reservedChars);
  return batch.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    startMs: row.start_ms,
    text: row.asset_id ? deps.readText(row.asset_id).slice(0, textChars) : "",
  }));
}

/** Written before each remote call: what leaves the computer, and to whom. */
export function auditNetwork(
  deps: PerimeterDeps,
  sessionId: string,
  ids: string[],
  adapter: ModelAdapter,
): void {
  recordAudit(deps.db, {
    sessionId,
    at: deps.nowWall(),
    action: "network",
    detail: {
      evidenceIds: ids,
      provider: adapter.provider,
      ...(adapter.workspaceId ? { workspaceId: adapter.workspaceId } : {}),
    },
  });
}
