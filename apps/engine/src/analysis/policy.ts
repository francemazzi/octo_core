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
  for (const episode of parsed.data.episodes) {
    for (const evidenceId of episode.evidenceIds) {
      if (!knownEvidence.has(evidenceId)) {
        throw new OctoError("unknown_evidence", evidenceId);
      }
    }
    if (episode.durationMs > sessionDurationMs) {
      throw new OctoError("invented_duration", `${episode.episodeId} exceeds the session`);
    }
  }
  return parsed.data;
}
