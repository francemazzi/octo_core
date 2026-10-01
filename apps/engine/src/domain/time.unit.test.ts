import { describe, expect, it } from "vitest";
import {
  naiveIntervalSumMs,
  summarizeAssignedTime,
  totalDurationMs,
  unionIntervals,
} from "./time.js";

describe("unionIntervals", () => {
  it("merges overlapping and touching intervals", () => {
    const merged = unionIntervals([
      { sourceId: "a", startMs: 0, endMs: 10 },
      { sourceId: "b", startMs: 10, endMs: 20 },
      { sourceId: "a", startMs: 15, endMs: 25 },
    ]);
    expect(merged).toEqual([{ startMs: 0, endMs: 25 }]);
    expect(
      totalDurationMs([
        { sourceId: "a", startMs: 0, endMs: 10 },
        { sourceId: "b", startMs: 0, endMs: 10 },
      ]),
    ).toBe(10);
  });

  it("ignores secondary labels and unauthorized sources", () => {
    const summary = summarizeAssignedTime(
      [
        {
          id: "p",
          episodeId: "A",
          assignment: "primary",
          kind: "work",
          intervals: [
            { sourceId: "mon-1", startMs: 0, endMs: 100 },
            { sourceId: "mon-2", startMs: 0, endMs: 100 },
          ],
        },
        {
          id: "s",
          episodeId: "A",
          assignment: "secondary",
          kind: "work",
          intervals: [{ sourceId: "mon-1", startMs: 0, endMs: 100 }],
        },
        {
          id: "x",
          episodeId: "X",
          assignment: "primary",
          kind: "work",
          intervals: [{ sourceId: "mon-3", startMs: 0, endMs: 500 }],
        },
      ],
      new Set(["mon-1", "mon-2"]),
    );
    expect(summary.byEpisodeMs.A).toBe(100);
    expect(summary.humanTotalMs).toBe(100);
    expect(summary.byEpisodeMs.X).toBeUndefined();
    expect(
      naiveIntervalSumMs(
        [
          {
            id: "p",
            episodeId: "A",
            assignment: "primary",
            kind: "work",
            intervals: [
              { sourceId: "mon-1", startMs: 0, endMs: 100 },
              { sourceId: "mon-2", startMs: 0, endMs: 100 },
            ],
          },
        ],
        new Set(["mon-1", "mon-2"]),
      ),
    ).toBe(200);
  });
});
