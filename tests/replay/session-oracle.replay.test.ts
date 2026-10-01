import { loadSessionOracle } from "@octo/test-fixtures";
import { summarizeAssignedTime } from "@octo/engine";
import { describe, expect, it } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("oracle replay", () => {
  it("stores the authorized frames and the union durations", () => {
    const session = loadSessionOracle();
    const summary = summarizeAssignedTime(
      [...session.stretches, ...session.secondaryLabels],
      new Set(["mon-1", "mon-2"]),
    );
    const { engine } = tempEngine();
    startDemo(engine);
    const replay = engine.replayCapture();
    expect(replay.stored).toBe(4);
    expect(summary.humanTotalMs).toBe(2_460_000);
    expect(summary.byEpisodeMs["episode-A"]).toBe(1_500_000);
    engine.close();
  });
});
