import { describe, expect, it } from "vitest";
import { frameStretches, type TimelineFrame } from "./frame-timeline.js";
import { summarizeAssignedTime } from "./time.js";

const authorized = new Set(["mon-1", "mon-2"]);

function summarize(frames: TimelineFrame[], episodes: Record<string, string>, endMs: number) {
  const stretches = frameStretches({
    frames,
    episodeOf: new Map(Object.entries(episodes)),
    sessionEndMs: endMs,
    maxFrameSpanMs: 60_000,
    gapSourceId: "mon-1",
  });
  return summarizeAssignedTime(stretches, authorized);
}

describe("frameStretches", () => {
  it("covers until the next frame on the same source, capped at the span", () => {
    const summary = summarize(
      [
        { evidenceId: "ev-a", sourceId: "mon-1", startMs: 0 },
        { evidenceId: "ev-b", sourceId: "mon-1", startMs: 30_000 },
        { evidenceId: "ev-c", sourceId: "mon-1", startMs: 200_000 },
      ],
      { "ev-a": "order", "ev-b": "order", "ev-c": "mail" },
      310_000,
    );
    expect(summary.byEpisodeMs).toEqual({ order: 90_000, mail: 60_000 });
    expect(summary.unknownMs).toBe(110_000 + 50_000);
    expect(summary.humanTotalMs).toBe(310_000);
  });

  it("stops at the session end and drops frames after it", () => {
    const summary = summarize(
      [
        { evidenceId: "ev-a", sourceId: "mon-1", startMs: 0 },
        { evidenceId: "ev-b", sourceId: "mon-1", startMs: 90_000 },
      ],
      { "ev-a": "order", "ev-b": "order" },
      40_000,
    );
    expect(summary.byEpisodeMs).toEqual({ order: 40_000 });
    expect(summary.unknownMs).toBe(0);
  });

  it("does not double count two monitors showing the same episode", () => {
    const summary = summarize(
      [
        { evidenceId: "ev-a", sourceId: "mon-1", startMs: 0 },
        { evidenceId: "ev-b", sourceId: "mon-2", startMs: 10_000 },
      ],
      { "ev-a": "order", "ev-b": "order" },
      60_000,
    );
    expect(summary.byEpisodeMs).toEqual({ order: 60_000 });
    expect(summary.humanTotalMs).toBe(60_000);
  });

  it("counts frames the model did not assign as unknown", () => {
    const summary = summarize(
      [
        { evidenceId: "ev-a", sourceId: "mon-1", startMs: 0 },
        { evidenceId: "ev-x", sourceId: "mon-1", startMs: 20_000 },
      ],
      { "ev-a": "order" },
      40_000,
    );
    expect(summary.byEpisodeMs).toEqual({ order: 20_000 });
    expect(summary.unknownMs).toBe(20_000);
  });

  it("extends coverage with repeats of a dropped duplicate screenshot", () => {
    const frames = [
      { evidenceId: "ev-a", sourceId: "mon-1", startMs: 0 },
      { evidenceId: "ev-a", sourceId: "mon-1", startMs: 60_000 },
      { evidenceId: "ev-a", sourceId: "mon-1", startMs: 120_000 },
    ];
    const stretches = frameStretches({
      frames,
      episodeOf: new Map([["ev-a", "order"]]),
      sessionEndMs: 150_000,
      maxFrameSpanMs: 60_000,
      gapSourceId: "mon-1",
    });
    expect(stretches).toHaveLength(1);
    expect(stretches[0]?.intervals).toEqual([{ sourceId: "mon-1", startMs: 0, endMs: 150_000 }]);
  });
});
