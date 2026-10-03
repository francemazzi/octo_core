import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, ollamaProfile } from "@octo/engine";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";

describe("live Ollama", () => {
  it("extracts episodes from the local model and writes the mini report when it is due", async () => {
    const previousModel = process.env.OCTO_MODEL;
    const previousName = process.env.OCTO_OLLAMA_MODEL;
    delete process.env.OCTO_MODEL;
    process.env.OCTO_OLLAMA_MODEL = "qwen2.5:7b-instruct-q4_K_M";
    const dir = mkdtempSync(join(tmpdir(), "octo-live-"));
    const engine = createEngine(dir, { analysis: ollamaProfile() });
    try {
      startDemo(engine);
      engine.ingestFrame({
        frameId: "f-order",
        sourceId: "mon-1",
        offsetMs: 0,
        payload: "inserimento ordine cliente Rossi",
      });
      engine.ingestFrame({
        frameId: "f-mail",
        sourceId: "mon-1",
        offsetMs: 60_000,
        payload: "risposta email al fornitore",
      });
      engine.setMono(10_000 + 120_000);
      engine.stopSession();

      const status = await engine.modelStatus();
      expect(status).toEqual({ up: true, model: "qwen2.5:7b-instruct-q4_K_M" });

      const analysis = await engine.runAnalysis("local_only");
      expect(analysis.reason).toBe("accepted");
      expect(analysis.episodes).toBeGreaterThan(0);

      const sessionDuration = engine.durationMs();
      const episodes = engine.listEpisodes() as Array<{ duration_ms: number }>;
      expect(episodes.length).toBe(analysis.episodes);
      for (const episode of episodes) {
        expect(episode.duration_ms).toBeLessThanOrEqual(sessionDuration);
      }
      const evidence = engine.listEvidence() as Array<{ start_ms: number }>;
      const starts = new Set(evidence.map((item) => item.start_ms));
      const intervals = engine.db
        .prepare("SELECT source_id, origin, start_ms FROM episode_intervals")
        .all() as Array<{
        source_id: string;
        origin: string;
        start_ms: number;
      }>;
      expect(intervals.length).toBeGreaterThan(0);
      for (const interval of intervals) {
        expect(interval.origin).toBe("ollama");
        expect(interval.source_id).toBe("mon-1");
        expect(starts.has(interval.start_ms)).toBe(true);
      }

      const again = await engine.runAnalysis("local_only");
      expect(again.reason).toBe("already_analyzed");
      const runs = engine.db.prepare("SELECT provider, outcome FROM analysis_runs").all();
      expect(runs).toEqual([{ provider: "ollama", outcome: "accepted" }]);

      engine.db
        .prepare("UPDATE sessions SET started_wall = ?")
        .run(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString());
      const report = await engine.reportTick();
      expect(report.issued).toBe(true);
      expect(report.path && existsSync(report.path)).toBe(true);
      expect(report.path?.startsWith(dir)).toBe(true);
    } finally {
      engine.close();
      if (previousModel === undefined) delete process.env.OCTO_MODEL;
      else process.env.OCTO_MODEL = previousModel;
      if (previousName === undefined) delete process.env.OCTO_OLLAMA_MODEL;
      else process.env.OCTO_OLLAMA_MODEL = previousName;
    }
  });
});
