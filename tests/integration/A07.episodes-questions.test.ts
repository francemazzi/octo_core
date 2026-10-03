import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, ollamaProfile } from "@octo/engine";
import { describe, expect, it, vi } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

function localModelStub(reply: unknown, chats: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/tags")) {
      return Response.json({ models: [{ name: "qwen2.5:7b-instruct-q4_K_M" }] });
    }
    chats.push(url);
    return Response.json({ message: { content: JSON.stringify(reply) } });
  }) as typeof fetch;
}

describe("A07 episodes and questions", () => {
  it("keeps A and B times, does not repeat questions after restart, and does not block recording", async () => {
    const { dir, engine } = tempEngine();
    startDemo(engine);
    engine.replayCapture();
    const first = await engine.runAnalysis("local_only");
    expect(first.capture).toBe("recording");
    expect(first.questionCount).toBe(1);
    const episodes = engine.listEpisodes() as Array<{
      id: string;
      duration_ms: number;
      review_state: string;
    }>;
    expect(episodes.find((episode) => episode.id === "episode-A")?.duration_ms).toBe(1_500_000);
    expect(episodes.find((episode) => episode.id === "episode-B")?.duration_ms).toBe(300_000);
    expect(episodes.every((episode) => episode.review_state !== "confirmed")).toBe(true);

    engine.close();
    const { createEngine } = await import("@octo/engine");
    const reopened = createEngine(dir);
    const second = await reopened.runAnalysis("local_only");
    expect(second.questionCount).toBe(1);
    expect(second.capture).toBe("recording");

    const memory = reopened.corrections("oracle-project");
    const id = memory.add("il codice fa parte dell'ordine");
    memory.revoke(id);
    expect(memory.active()).toHaveLength(0);
    expect(memory.trainingExport()).toEqual([]);
    reopened.close();
  });

  it("derives episode time from frames with a stubbed local model", async () => {
    const globalFetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", globalFetch);
    const chats: string[] = [];
    const reply = {
      episodes: [
        {
          episodeId: "order",
          activityType: "order_entry",
          evidenceIds: ["ev-f-order", "ev-f-order-2"],
        },
        { episodeId: "mail", activityType: "mail", evidenceIds: ["ev-f-mail"] },
      ],
    };
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a07-frames-")), {
      analysis: ollamaProfile({
        base: "http://127.0.0.1:11434",
        fetchImpl: localModelStub(reply, chats),
      }),
    });
    try {
      startDemo(engine);
      const frame = (frameId: string, sourceId: string, offsetMs: number, payload: string) =>
        engine.ingestFrame({ frameId, sourceId, offsetMs, payload });
      frame("f-order", "mon-1", 0, "ordine cliente Rossi");
      frame("f-order-copy", "mon-2", 10_000, "ordine cliente Rossi");
      frame("f-order-2", "mon-1", 30_000, "ordine cliente Rossi riga 2");
      frame("f-mail", "mon-1", 200_000, "risposta mail fornitore");
      engine.setMono(10_000 + 310_000);
      engine.stopSession();

      const first = await engine.runAnalysis("local_only");
      expect(first).toMatchObject({
        analysis: "completed",
        reason: "accepted",
        model: "qwen2.5:7b-instruct-q4_K_M",
        episodes: 2,
      });
      const episodes = engine.listEpisodes() as Array<{
        id: string;
        activity_type: string;
        duration_ms: number;
      }>;
      const order = episodes.find((episode) => episode.activity_type === "order_entry");
      const mail = episodes.find((episode) => episode.activity_type === "mail");
      expect(order?.duration_ms).toBe(90_000);
      expect(mail?.duration_ms).toBe(60_000);
      const summary = engine.db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'time_summary'")
        .get() as { detail_json: string };
      expect(JSON.parse(summary.detail_json)).toMatchObject({
        unknownMs: 160_000,
        humanTotalMs: 310_000,
      });
      const origins = engine.db
        .prepare("SELECT DISTINCT origin FROM episode_intervals")
        .all() as Array<{ origin: string }>;
      expect(origins).toEqual([{ origin: "ollama" }]);
      const run = engine.db
        .prepare("SELECT model, provider, prompt_schema, outcome FROM analysis_runs")
        .get();
      expect(run).toEqual({
        model: "qwen2.5:7b-instruct-q4_K_M",
        provider: "ollama",
        prompt_schema: "episodes@3",
        outcome: "accepted",
      });

      const orderId = order?.id ?? "";
      const part = engine.splitEpisode(orderId, 45_000);
      engine.mergeEpisodes(part, orderId);
      const merged = (engine.listEpisodes() as Array<{ id: string; duration_ms: number }>).find(
        (episode) => episode.id === orderId,
      );
      expect(merged?.duration_ms).toBe(90_000);

      const again = await engine.runAnalysis("local_only");
      expect(again.reason).toBe("already_analyzed");
      expect(chats).toHaveLength(1);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      engine.close();
      vi.unstubAllGlobals();
    }
  });

  it("resumes the graph after an accepted answer, even after a restart", async () => {
    const { dir, engine } = tempEngine();
    startDemo(engine);
    engine.replayCapture();
    expect((await engine.runAnalysis("local_only")).analysis).toBe("awaiting_answer");
    const [question] = engine.openQuestions();
    expect(question?.episodeId).toBe("episode-A");
    const questionId = question?.questionId ?? "";

    const crossEpisode = await engine.answerQuestion({
      questionId,
      episodeId: "episode-B",
      text: "no",
    });
    expect(crossEpisode).toEqual({ status: "quarantined", analysis: null });
    engine.deferQuestion(questionId);
    engine.close();

    const reopened = createEngine(dir);
    const runs = () =>
      (
        reopened.db.prepare("SELECT COUNT(*) AS count FROM analysis_runs").get() as {
          count: number;
        }
      ).count;
    try {
      const waiting = await reopened.runAnalysis("local_only");
      expect(waiting).toMatchObject({ analysis: "awaiting_answer", reason: "already_analyzed" });
      expect(runs()).toBe(1);

      const answered = await reopened.answerQuestion({
        questionId,
        episodeId: "episode-A",
        text: "sì, stesso ordine",
      });
      expect(answered).toEqual({ status: "accepted", analysis: "completed" });
      const completed = reopened.db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'analysis_completed'")
        .all() as Array<{ detail_json: string }>;
      expect(completed.map((row) => JSON.parse(row.detail_json) as unknown)).toEqual([
        { questionId, questionStatus: "answered" },
      ]);
      expect(reopened.openQuestions()).toHaveLength(0);

      const after = await reopened.runAnalysis("local_only");
      expect(after).toMatchObject({ analysis: "completed", reason: "already_analyzed" });
      expect(runs()).toBe(1);

      const late = await reopened.answerQuestion({
        questionId,
        episodeId: "episode-A",
        text: "ripensandoci no",
      });
      expect(late.status).toBe("quarantined");
    } finally {
      reopened.close();
    }
  });

  it("asks the operator when the local model is unsure and resumes on the answer", async () => {
    const chats: string[] = [];
    const reply = {
      episodes: [
        {
          episodeId: "order",
          activityType: "order_entry",
          evidenceIds: ["ev-q-order", "ev-q-search"],
        },
      ],
      questions: [
        {
          episodeId: "order",
          prompt: "La ricerca codice fa parte dell'ordine?",
          evidenceIds: ["ev-q-search"],
        },
      ],
    };
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a07-ask-")), {
      analysis: ollamaProfile({
        base: "http://127.0.0.1:11434",
        fetchImpl: localModelStub(reply, chats),
      }),
    });
    try {
      startDemo(engine);
      engine.ingestFrame({ frameId: "q-order", sourceId: "mon-1", offsetMs: 0, payload: "ordine" });
      engine.ingestFrame({
        frameId: "q-search",
        sourceId: "mon-1",
        offsetMs: 20_000,
        payload: "ricerca codice articolo",
      });
      engine.setMono(10_000 + 60_000);
      engine.stopSession();

      expect((await engine.runAnalysis("local_only")).analysis).toBe("awaiting_answer");
      const [question] = engine.openQuestions();
      expect(question?.prompt).toBe("La ricerca codice fa parte dell'ordine?");
      const answered = await engine.answerQuestion({
        questionId: question?.questionId ?? "",
        episodeId: question?.episodeId ?? "",
        text: "sì",
      });
      expect(answered).toEqual({ status: "accepted", analysis: "completed" });
      expect(chats).toHaveLength(1);
    } finally {
      engine.close();
    }
  });
});
