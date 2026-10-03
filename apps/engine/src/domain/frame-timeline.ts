import { unionIntervals, type Stretch } from "./time.js";

export const DEFAULT_FRAME_SPAN_MS = 60_000;

export type TimelineFrame = { evidenceId: string; sourceId: string; startMs: number };

export type FrameTimelineInput = {
  frames: TimelineFrame[];
  episodeOf: ReadonlyMap<string, string>;
  sessionEndMs: number;
  maxFrameSpanMs: number;
  gapSourceId: string;
};

type Covered = { sourceId: string; startMs: number; endMs: number; episodeId: string | null };

/**
 * A frame covers its source until the next frame on that source, at most `maxFrameSpanMs`,
 * never past the session end. Frames without an episode and uncovered time become `unknown`.
 */
export function frameStretches(input: FrameTimelineInput): Stretch[] {
  const covered = coverFrames(input);
  const stretches: Stretch[] = mergeAdjacent(covered).map((item, index) => ({
    id: `frame-${index}`,
    episodeId: item.episodeId,
    assignment: item.episodeId ? "primary" : "unknown",
    kind: item.episodeId ? "work" : "unknown",
    intervals: [{ sourceId: item.sourceId, startMs: item.startMs, endMs: item.endMs }],
  }));
  const gaps = gapsWithin(covered, input.sessionEndMs);
  if (gaps.length > 0) {
    stretches.push({
      id: "frame-gaps",
      episodeId: null,
      assignment: "unknown",
      kind: "unknown",
      intervals: gaps.map((gap) => ({ sourceId: input.gapSourceId, ...gap })),
    });
  }
  return stretches;
}

function coverFrames(input: FrameTimelineInput): Covered[] {
  const bySource = new Map<string, TimelineFrame[]>();
  for (const frame of input.frames) {
    const list = bySource.get(frame.sourceId) ?? [];
    list.push(frame);
    bySource.set(frame.sourceId, list);
  }
  const covered: Covered[] = [];
  for (const frames of bySource.values()) {
    const sorted = [...frames].sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((frame, index) => {
      const next = sorted[index + 1]?.startMs ?? Number.POSITIVE_INFINITY;
      const startMs = Math.max(frame.startMs, 0);
      const endMs = Math.min(next, frame.startMs + input.maxFrameSpanMs, input.sessionEndMs);
      if (endMs <= startMs) return;
      const episodeId = input.episodeOf.get(frame.evidenceId) ?? null;
      covered.push({ sourceId: frame.sourceId, startMs, endMs, episodeId });
    });
  }
  return covered;
}

function mergeAdjacent(covered: Covered[]): Covered[] {
  const sorted = [...covered].sort(
    (a, b) => a.sourceId.localeCompare(b.sourceId) || a.startMs - b.startMs,
  );
  const merged: Covered[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    const joins =
      last &&
      last.sourceId === item.sourceId &&
      last.episodeId === item.episodeId &&
      last.endMs === item.startMs;
    if (joins) last.endMs = item.endMs;
    else merged.push({ ...item });
  }
  return merged;
}

function gapsWithin(
  covered: Covered[],
  sessionEndMs: number,
): Array<{ startMs: number; endMs: number }> {
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const interval of unionIntervals(covered)) {
    if (interval.startMs > cursor) gaps.push({ startMs: cursor, endMs: interval.startMs });
    cursor = Math.max(cursor, interval.endMs);
  }
  if (sessionEndMs > cursor) gaps.push({ startMs: cursor, endMs: sessionEndMs });
  return gaps;
}
