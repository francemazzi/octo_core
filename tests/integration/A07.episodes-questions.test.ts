import { describe, expect, it } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

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
});
