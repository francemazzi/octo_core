import type { ModelOutput } from "@octo/contracts";
import type { KnownActivity } from "./model-adapter.js";

const MAX_QUESTIONS = 2;
const MAX_KNOWN_ACTIVITIES = 40;
const MAX_TEXT_CHARS = 500;
const MIN_TEXT_CHARS = 120;
/** Screen text budget for one prompt, split across the evidence of a batch. */
const PROMPT_TEXT_BUDGET = 24_000;

export type BatchPlan<T> = { batches: T[][]; evidenceTotal: number; evidenceSent: number };

/** Evidence in time order, cut in batches; what does not fit in `maxBatches` is not sent. */
export function planBatches<T>(rows: readonly T[], size: number, maxBatches: number): BatchPlan<T> {
  const batches: T[][] = [];
  for (let start = 0; start < rows.length && batches.length < maxBatches; start += size) {
    batches.push(rows.slice(start, start + size));
  }
  const evidenceSent = batches.reduce((sum, batch) => sum + batch.length, 0);
  return { batches, evidenceTotal: rows.length, evidenceSent };
}

/** Characters of screen text per evidence, after the room taken by the known activities. */
export function textCharsFor(count: number, reservedChars = 0): number {
  const available = Math.max(0, PROMPT_TEXT_BUDGET - reservedChars);
  return Math.min(MAX_TEXT_CHARS, Math.max(MIN_TEXT_CHARS, Math.floor(available / count)));
}

/**
 * One output for the whole session: batches that reuse an episode id add their evidence to it,
 * the first label, summary and title found win, and questions stay within the usual limit.
 */
export function mergeOutputs(outputs: readonly ModelOutput[]): ModelOutput {
  const episodes = new Map<string, ModelOutput["episodes"][number]>();
  for (const output of outputs) {
    for (const episode of output.episodes) {
      const existing = episodes.get(episode.episodeId);
      if (!existing) {
        episodes.set(episode.episodeId, { ...episode, evidenceIds: [...episode.evidenceIds] });
        continue;
      }
      existing.evidenceIds.push(...episode.evidenceIds);
      existing.label ??= episode.label;
      existing.summary ??= episode.summary;
    }
  }
  const seen = new Set<string>();
  const questions = outputs
    .flatMap((output) => output.questions ?? [])
    .filter((question) => {
      const key = `${question.episodeId}\n${question.prompt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_QUESTIONS);
  const title = outputs.find((output) => output.title)?.title;
  return { ...(title ? { title } : {}), episodes: [...episodes.values()], questions };
}

/** The activities the next batch may continue, newest last, within the prompt budget. */
export function knownActivities(output: ModelOutput): KnownActivity[] {
  return output.episodes.slice(-MAX_KNOWN_ACTIVITIES).map((episode) => ({
    episodeId: episode.episodeId,
    activityType: episode.activityType,
    ...(episode.label ? { label: episode.label } : {}),
  }));
}
