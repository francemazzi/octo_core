import { acceptModelOutput, OctoError } from "@octo/engine";
import { describe, expect, it, vi } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A06 model policy", () => {
  it("keeps local_only offline, limits cloud review to approved evidence, and rejects bad output", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetchSpy);
    const { engine } = tempEngine();
    startDemo(engine);
    engine.replayCapture();
    const local = await engine.runAnalysis("local_only");
    expect(local.capture).toBe("recording");
    expect(engine.networkAudits()).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const runs = engine.db.prepare("SELECT data_mode FROM analysis_runs").all() as Array<{
      data_mode: string;
    }>;
    expect(runs.every((run) => run.data_mode === "local_only")).toBe(true);

    engine.approveEvidence("ev-frame-a1");
    await engine.runAnalysis("cloud_after_review");
    const audits = engine.networkAudits() as Array<{ detail_json: string }>;
    expect(audits.length).toBeGreaterThan(0);
    const sent = JSON.parse(audits[0]?.detail_json ?? "{}") as { evidenceIds: string[] };
    expect(sent.evidenceIds).toEqual(["ev-frame-a1"]);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            { episodeId: "x", activityType: "a", evidenceIds: ["missing"], durationMs: 1 },
          ],
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            {
              episodeId: "x",
              activityType: "a",
              evidenceIds: ["ev-frame-a1"],
              durationMs: 9_999_999,
            },
          ],
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            { episodeId: "x", activityType: "a", evidenceIds: ["ev-frame-a1"], durationMs: 1 },
          ],
          policyOverride: "cloud_live_authorized",
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
    engine.close();
    vi.unstubAllGlobals();
  });
});
