import { describe, expect, it } from "vitest";
import { evidenceLines, normalizeReply, parseModelReply } from "./reply.js";

describe("model reply", () => {
  it("reads episodes and questions from a noisy reply", () => {
    expect(
      parseModelReply(
        'note {"episodes":[{"episodeId":"ep1","activityType":"mail","evidenceIds":["ev-1", 2]}],' +
          '"questions":[{"episodeId":"ep1","prompt":"Stesso fornitore?","evidenceIds":["ev-1"]}]}',
      ),
    ).toEqual({
      episodes: [{ episodeId: "ep1", activityType: "mail", evidenceIds: ["ev-1"] }],
      questions: [{ episodeId: "ep1", prompt: "Stesso fornitore?", evidenceIds: ["ev-1"] }],
    });
    expect(parseModelReply("not json")).toEqual({ episodes: [], questions: [] });
    expect(parseModelReply("{ broken")).toEqual({ episodes: [], questions: [] });
  });

  it("keeps known evidence once and remaps questions to the new episode ids", () => {
    const normalized = normalizeReply(
      {
        episodes: [
          { episodeId: "order", activityType: "order entry!", evidenceIds: ["ev-a", "ev-zz"] },
          { episodeId: "mail", activityType: "mail", evidenceIds: ["ev-a", "ev-b"] },
          { episodeId: "ghost", activityType: "x", evidenceIds: ["ev-zz"] },
        ],
        questions: [
          { episodeId: "order", prompt: "Stesso\nordine?", evidenceIds: ["ev-a", "ev-zz"] },
          { episodeId: "ghost", prompt: "Perso?", evidenceIds: [] },
          { episodeId: "mail", prompt: "Mail?", evidenceIds: [] },
          { episodeId: "mail", prompt: "Terza?", evidenceIds: [] },
        ],
      },
      new Set(["ev-a", "ev-b"]),
      "abcd1234",
    );
    expect(normalized.episodes).toEqual([
      { episodeId: "order-1-abcd1234", activityType: "orderentry", evidenceIds: ["ev-a"] },
      { episodeId: "mail-2-abcd1234", activityType: "mail", evidenceIds: ["ev-b"] },
    ]);
    expect(normalized.questions).toEqual([
      { episodeId: "order-1-abcd1234", prompt: "Stesso ordine?", evidenceIds: ["ev-a"] },
      { episodeId: "mail-2-abcd1234", prompt: "Mail?", evidenceIds: [] },
    ]);
  });

  it("puts one evidence per line and keeps screen text on its line", () => {
    expect(
      evidenceLines([
        { id: "ev-a", sourceId: "mon-1", startMs: 0, text: "riga uno\nriga due" },
        { id: "ev-b", sourceId: "mon-1", startMs: 30_000, text: "posta" },
      ]),
    ).toBe("- id=ev-a offsetMs=0 text=riga uno riga due\n- id=ev-b offsetMs=30000 text=posta");
  });
});
