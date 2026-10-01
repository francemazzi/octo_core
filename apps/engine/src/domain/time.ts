export type TimeInterval = {
  sourceId: string;
  startMs: number;
  endMs: number;
};

export type Assignment = "primary" | "secondary" | "unknown";

export type StretchKind = "work" | "code_search" | "declared_wait" | "unknown";

export type Stretch = {
  id: string;
  episodeId: string | null;
  assignment: Assignment;
  kind: StretchKind;
  intervals: TimeInterval[];
};

export type TimeSummary = {
  byEpisodeMs: Record<string, number>;
  declaredWaitMs: number;
  unknownMs: number;
  humanTotalMs: number;
};

export function unionIntervals(
  intervals: TimeInterval[],
): Array<{ startMs: number; endMs: number }> {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.startMs > last.endMs) {
      merged.push({ ...interval });
    } else if (interval.endMs > last.endMs) {
      last.endMs = interval.endMs;
    }
  }
  return merged;
}

export function totalDurationMs(intervals: TimeInterval[]): number {
  return unionIntervals(intervals).reduce(
    (sum, interval) => sum + (interval.endMs - interval.startMs),
    0,
  );
}

function authorizedIntervals(
  stretch: Stretch,
  authorizedSourceIds: ReadonlySet<string>,
): TimeInterval[] {
  return stretch.intervals.filter(
    (interval) => authorizedSourceIds.has(interval.sourceId) && interval.endMs > interval.startMs,
  );
}

export function summarizeAssignedTime(
  stretches: Stretch[],
  authorizedSourceIds: ReadonlySet<string>,
): TimeSummary {
  const counted: TimeInterval[] = [];
  const byEpisode = new Map<string, TimeInterval[]>();
  const wait: TimeInterval[] = [];
  const unknown: TimeInterval[] = [];

  for (const stretch of stretches) {
    if (stretch.assignment === "secondary") continue;
    const intervals = authorizedIntervals(stretch, authorizedSourceIds);
    if (stretch.assignment === "unknown" || stretch.kind === "unknown") {
      unknown.push(...intervals);
      counted.push(...intervals);
      continue;
    }
    if (stretch.kind === "declared_wait") {
      wait.push(...intervals);
      counted.push(...intervals);
      continue;
    }
    if (stretch.episodeId && intervals.length > 0) {
      const list = byEpisode.get(stretch.episodeId) ?? [];
      list.push(...intervals);
      byEpisode.set(stretch.episodeId, list);
    }
    counted.push(...intervals);
  }

  const byEpisodeMs: Record<string, number> = {};
  for (const [episodeId, intervals] of byEpisode) {
    byEpisodeMs[episodeId] = totalDurationMs(intervals);
  }

  return {
    byEpisodeMs,
    declaredWaitMs: totalDurationMs(wait),
    unknownMs: totalDurationMs(unknown),
    humanTotalMs: totalDurationMs(counted),
  };
}

export function naiveIntervalSumMs(
  stretches: Stretch[],
  authorizedSourceIds: ReadonlySet<string>,
): number {
  let sum = 0;
  for (const stretch of stretches) {
    if (stretch.assignment === "secondary") continue;
    for (const interval of authorizedIntervals(stretch, authorizedSourceIds)) {
      sum += interval.endMs - interval.startMs;
    }
  }
  return sum;
}
