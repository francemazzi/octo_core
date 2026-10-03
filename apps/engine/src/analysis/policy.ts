import { modelOutputSchema, type ModelOutput } from "@octo/contracts";
import { OctoError } from "../errors.js";

export type DataMode = "local_only" | "cloud_after_review" | "cloud_live_authorized";

export type EvidenceRef = { id: string; reviewState: string; sessionId: string };

export function evidenceIdsForMode(
  mode: DataMode,
  sessionId: string,
  evidence: EvidenceRef[],
): string[] {
  const inSession = evidence.filter((item) => item.sessionId === sessionId);
  if (mode === "local_only") return [];
  if (mode === "cloud_after_review") {
    return inSession.filter((item) => item.reviewState === "approved").map((item) => item.id);
  }
  return inSession.map((item) => item.id);
}

export function acceptModelOutput(
  raw: unknown,
  knownEvidence: ReadonlySet<string>,
  sessionDurationMs: number,
): ModelOutput {
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OctoError("invalid_model_output", parsed.error.message);
  }
  if (parsed.data.episodes.length === 0) {
    throw new OctoError("empty_output", "the model proposed no episode");
  }
  const assigned = new Set<string>();
  for (const episode of parsed.data.episodes) {
    for (const evidenceId of episode.evidenceIds) {
      assertKnown(knownEvidence, evidenceId);
      if (assigned.has(evidenceId)) throw new OctoError("duplicate_evidence", evidenceId);
      assigned.add(evidenceId);
    }
    if ((episode.durationMs ?? 0) > sessionDurationMs) {
      throw new OctoError("invented_duration", `${episode.episodeId} exceeds the session`);
    }
  }
  const episodeIds = new Set(parsed.data.episodes.map((episode) => episode.episodeId));
  for (const question of parsed.data.questions ?? []) {
    if (!episodeIds.has(question.episodeId)) {
      throw new OctoError("unknown_episode", question.episodeId);
    }
    for (const evidenceId of question.evidenceIds) assertKnown(knownEvidence, evidenceId);
  }
  return parsed.data;
}

function assertKnown(knownEvidence: ReadonlySet<string>, evidenceId: string): void {
  if (!knownEvidence.has(evidenceId)) throw new OctoError("unknown_evidence", evidenceId);
}
