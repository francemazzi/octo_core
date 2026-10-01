import { loadSessionOracle } from "@octo/test-fixtures";
import { summarizeAssignedTime } from "@octo/engine";
import { describe, expect, it, vi } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A05 synthetic capture and time", () => {
  it("replays the oracle without doubling time, secrets, or unauthorized sources", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const session = loadSessionOracle();
    const authorized = new Set(["mon-1", "mon-2"]);
    const summary = summarizeAssignedTime(
      [...session.stretches, ...session.secondaryLabels],
      authorized,
    );
    expect(summary.humanTotalMs).toBe(session.expected.humanTotalMs);

    const { engine } = tempEngine();
    startDemo(engine);
    const replay = engine.replayCapture();
    expect(replay.stored).toBe(4);
    const assets = engine.listAssets() as Array<{
      hash: string;
      state: string;
      session_id: string;
    }>;
    const hashes = assets.filter((asset) => asset.state === "valid").map((asset) => asset.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    const evidence = engine.listEvidence() as Array<{
      source_id: string;
      content_hash: string;
      asset_id: string;
    }>;
    expect(evidence.some((item) => item.source_id === "mon-3")).toBe(false);
    for (const item of evidence) {
      const text = engine.media.readPlaintext(item.asset_id).toString("utf8");
      expect(text).not.toContain("SYNTHETIC_SECRET_MARKER");
    }
    const kinds = (engine.listEvents() as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["stream_terminated", "pause", "backpressure"]));
    expect(fetchSpy).not.toHaveBeenCalled();

    engine.pauseSession();
    const dropped = engine.ingestFrame({
      frameId: "after-pause",
      sourceId: "mon-1",
      offsetMs: 9_999_999,
      payload: "should-drop",
    });
    expect(dropped.stored).toBe(false);
    expect(
      (engine.listEvidence() as Array<{ start_ms: number }>).some(
        (item) => item.start_ms === 9_999_999,
      ),
    ).toBe(false);
    engine.close();
    vi.unstubAllGlobals();
  });
});
