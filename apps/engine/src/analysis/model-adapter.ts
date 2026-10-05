import type { ModelOutput } from "@octo/contracts";
import { frameStretches, type TimelineFrame } from "../domain/frame-timeline.js";
import type { Stretch } from "../domain/time.js";

export type ModelLocality = "local" | "remote";

export type ModelEvidence = { id: string; sourceId: string; startMs: number; text: string };

/** What the reply cited that does not exist: the run is rejected when evidence is involved. */
export type ReplyIssues = {
  unknownEvidence: string[];
  duplicateEvidence: string[];
  orphanQuestions: string[];
};

export type ModelReply = {
  model: string;
  raw: unknown;
  usage?: Record<string, number>;
  issues?: ReplyIssues;
};

/** An activity found in an earlier batch of the same session, which the model may continue. */
export type KnownActivity = { episodeId: string; activityType: string; label?: string };

export type ModelStatus = { up: boolean; model: string | null };

/**
 * A model sees evidence text and returns raw JSON. It gets no shell, file or network tools:
 * the graph validates the reply with `acceptModelOutput` before anything is written.
 * `interpret` throws `OctoError("model_unavailable")` when the model cannot be reached; `known`
 * lists the activities of earlier batches, which the reply may continue by id.
 */
export interface ModelAdapter {
  readonly provider: string;
  readonly locality: ModelLocality;
  readonly promptSchema: string;
  status(): Promise<ModelStatus>;
  interpret(evidence: ModelEvidence[], known?: readonly KnownActivity[]): Promise<ModelReply>;
}

export type TimelineInput = {
  output: ModelOutput;
  frames: TimelineFrame[];
  sessionEndMs: number;
  authorizedSourceIds: string[];
};

export type TimelineBuilder = (input: TimelineInput) => Stretch[];

/** Episode time from the captured frames, assigned to episodes by the accepted model output. */
export function frameTimeline(maxFrameSpanMs: number): TimelineBuilder {
  return (input) =>
    frameStretches({
      frames: input.frames,
      episodeOf: new Map(
        input.output.episodes.flatMap((episode) =>
          episode.evidenceIds.map((evidenceId) => [evidenceId, episode.episodeId] as const),
        ),
      ),
      sessionEndMs: input.sessionEndMs,
      maxFrameSpanMs,
      gapSourceId: input.authorizedSourceIds[0] ?? "unknown",
    });
}

export type AnalysisProfile = {
  models: { local?: ModelAdapter; remote?: ModelAdapter };
  timeline: TimelineBuilder;
};
