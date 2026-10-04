import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionDetailResultSchema, sessionListResultSchema } from "@octo/contracts";
import { describe, expect, it } from "vitest";
import { createEngine } from "../create-engine.js";

const demo = {
  projectId: "oracle-project",
  operatorPseudonym: "op",
  sourceIds: ["mon-1", "mon-2"],
  purpose: "Inserimento ordini",
};

describe("session listing", () => {
  it("lists sessions newest first and details activities in time order", async () => {
    let wall = "2026-10-03T08:00:00.000Z";
    let mono = 10_000;
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-listing-")), {
      nowWall: () => wall,
      nowMono: () => mono,
    });
    try {
      const first = engine.startSession(demo).sessionId;
      engine.replayCapture();
      mono += 2_460_000;
      engine.stopSession();
      await engine.runAnalysis("local_only");
      wall = "2026-10-04T09:30:00.000Z";
      const second = engine.startSession(demo).sessionId;

      const listed = sessionListResultSchema.parse({ sessions: engine.listSessions() });
      expect(listed.sessions.map((session) => session.sessionId)).toEqual([second, first]);
      expect(listed.sessions[1]).toMatchObject({
        title: "Inserimento ordine cliente",
        captureState: "stopped",
        analysisState: "awaiting_answer",
        episodeCount: 2,
        openQuestionCount: 1,
        durationMs: 2_460_000,
        sourceIds: ["mon-1", "mon-2"],
      });
      expect(listed.sessions[0]).toMatchObject({ title: null, captureState: "recording" });

      const detail = sessionDetailResultSchema.parse(engine.sessionDetail(first));
      expect(detail.episodes.map((episode) => [episode.episodeId, episode.label])).toEqual([
        ["episode-A", "Inserimento ordine cliente"],
        ["episode-B", "Risposta a una mail"],
      ]);
      expect(detail.questions).toHaveLength(1);
      expect(detail.lastRun).toMatchObject({ outcome: "accepted", model: "mock", error: null });
      expect(() => engine.sessionDetail("missing")).toThrow("missing");
    } finally {
      engine.close();
    }
  });
});
