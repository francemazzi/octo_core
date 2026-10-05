import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "../create-engine.js";
import { OctoError } from "../errors.js";
import { frameTimeline, type ModelAdapter, type ModelLocality } from "./model-adapter.js";

/** Groups every evidence it receives in one episode, optionally asking one question. */
function stubModel(locality: ModelLocality, episodeId: string, question?: string): ModelAdapter {
  return {
    provider: `stub-${locality}`,
    locality,
    promptSchema: "stub@1",
    status: () => Promise.resolve({ up: true, model: "stub" }),
    interpret: (evidence) =>
      Promise.resolve({
        model: "stub",
        raw: {
          episodes: [
            {
              episodeId,
              activityType: "order_entry",
              label: `Ordine ${locality}`,
              evidenceIds: evidence.map((item) => item.id),
            },
          ],
          questions: question ? [{ episodeId, prompt: question, evidenceIds: [] }] : [],
        },
      }),
  };
}

function failingModel(): ModelAdapter {
  return {
    ...stubModel("remote", "never"),
    interpret: () => Promise.reject(new OctoError("model_error", "remote down")),
  };
}

function recordedSession(remote: ModelAdapter) {
  const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-episodes-")), {
    analysis: {
      models: { local: stubModel("local", "local-ep", "Stesso ordine?"), remote },
      timeline: frameTimeline(60_000),
    },
  });
  const { sessionId } = engine.startSession({
    projectId: "oracle-project",
    operatorPseudonym: "op-demo",
    sourceIds: ["mon-1"],
    purpose: "Inserimento ordini",
  });
  engine.ingestFrame({ frameId: "f-1", sourceId: "mon-1", offsetMs: 0, payload: "ordine Rossi" });
  engine.ingestFrame({ frameId: "f-2", sourceId: "mon-1", offsetMs: 30_000, payload: "riga 2" });
  engine.setMono(10_000 + 60_000);
  return { engine, sessionId };
}

function episodeIds(engine: ReturnType<typeof createEngine>): string[] {
  return (
    engine.db.prepare("SELECT id FROM episodes ORDER BY id").all() as Array<{ id: string }>
  ).map((row) => row.id);
}

describe("re-analysis and approval", () => {
  it("approves a stopped session once and lets the cloud run replace the proposed episodes", async () => {
    const { engine, sessionId } = recordedSession(stubModel("remote", "cloud-ep"));
    try {
      expect(() => engine.approveSession(sessionId)).toThrow(
        expect.objectContaining({ code: "session_active" }),
      );
      engine.stopSession();
      const local = await engine.runAnalysis("local_only", sessionId);
      expect(local).toMatchObject({ analysis: "awaiting_answer", episodes: 1 });

      expect(engine.approveSession(sessionId)).toEqual({ approved: 2, total: 2 });
      expect(engine.approveSession(sessionId)).toEqual({ approved: 0, total: 2 });
      expect(
        engine.db.prepare("SELECT DISTINCT approved_by FROM evidence").all() as unknown[],
      ).toEqual([{ approved_by: "operator:op-demo" }]);

      const cloud = await engine.runAnalysis("cloud_after_review", sessionId);
      expect(cloud).toMatchObject({ analysis: "completed", reason: "accepted", episodes: 1 });
      expect(episodeIds(engine)).toEqual(["cloud-ep"]);
      expect(engine.db.prepare("SELECT status FROM questions").all()).toEqual([
        { status: "superseded" },
      ]);
      expect(engine.openQuestions()).toEqual([]);
      const actions = engine.db
        .prepare(
          "SELECT action FROM audit_events WHERE action IN ('evidence_approved', 'episodes_replaced')",
        )
        .all();
      expect(actions).toEqual([
        { action: "evidence_approved" },
        { action: "evidence_approved" },
        { action: "episodes_replaced" },
      ]);
    } finally {
      engine.close();
    }
  });

  it("keeps the activities when a re-analysis fails", async () => {
    const { engine, sessionId } = recordedSession(failingModel());
    try {
      engine.stopSession();
      await engine.runAnalysis("local_only", sessionId);
      engine.approveSession(sessionId);
      const cloud = await engine.runAnalysis("cloud_after_review", sessionId);
      expect(cloud).toMatchObject({ analysis: "completed", reason: "model_error", episodes: 1 });
      expect(episodeIds(engine)).toEqual(["local-ep"]);
      expect(engine.db.prepare("SELECT data_mode FROM sessions").get()).toEqual({
        data_mode: "local_only",
      });
    } finally {
      engine.close();
    }
  });

  it("never replaces activities a person confirmed", async () => {
    const { engine, sessionId } = recordedSession(stubModel("remote", "cloud-ep"));
    try {
      engine.stopSession();
      await engine.runAnalysis("local_only", sessionId);
      engine.confirmEpisode("local-ep");
      engine.approveSession(sessionId);
      const runs = () =>
        (
          engine.db.prepare("SELECT COUNT(*) AS count FROM analysis_runs").get() as {
            count: number;
          }
        ).count;
      const before = runs();
      const cloud = await engine.runAnalysis("cloud_after_review", sessionId);
      expect(cloud.reason).toBe("reviewed_session");
      expect(runs()).toBe(before);
      expect(episodeIds(engine)).toEqual(["local-ep"]);
    } finally {
      engine.close();
    }
  });
});
