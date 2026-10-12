import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { parseChatReply, screenLabel, validateChatReply } from "./reply.js";

const evidence = [
  { id: "ev-frame-a1", sourceId: "mon-1", startMs: 100_000, text: "ordine" },
  { id: "ev-frame-b", sourceId: "mon-1", startMs: 3_700_000, text: "mail" },
];
const episodes = [
  { episodeId: "episode-A", label: "Inserimento ordine", activityType: "order_entry" },
  { episodeId: "episode-B", label: null, activityType: "interruption" },
];

describe("session assistant reply", () => {
  it("reads JSON inside prose and accepts shorthand citations", () => {
    const content =
      'Ecco: {"answer":"Hai inserito un ordine.","citations":["e1",2,{"type":"episode","id":"episode-A"},{"id":7},{"bad":true}]} fine';
    expect(parseChatReply(content)).toEqual({
      answer: "Hai inserito un ordine.",
      citations: [{ id: "e1" }, { id: "2" }, { type: "episode", id: "episode-A" }, { id: "7" }],
    });
    expect(parseChatReply("niente json")).toEqual({ citations: [] });
    expect(parseChatReply("{not json}")).toEqual({ citations: [] });
  });

  it("labels screenshots by capture offset", () => {
    expect(screenLabel(0)).toBe("Schermata +00:00");
    expect(screenLabel(100_000)).toBe("Schermata +01:40");
    expect(screenLabel(3_700_000)).toBe("Schermata +1:01:40");
  });

  it("resolves aliases, full ids and episodes, drops the rest and caps duplicates", () => {
    const validated = validateChatReply(
      {
        answer: " Hai\u0000inserito   un ordine. ",
        citations: [
          { id: "e1" },
          { id: "E1" },
          { type: "evidence", id: "ev-frame-b" },
          { type: "episode", id: "episode-B" },
          { id: "episode-A" },
          { id: "e9" },
          { type: "episode", id: "e1" },
          { type: "evidence", id: "episode-A" },
        ],
      },
      evidence,
      episodes,
    );
    expect(validated.answer).toBe("Hai inserito un ordine.");
    expect(validated.citations).toEqual([
      { type: "evidence", id: "ev-frame-a1", label: "Schermata +01:40" },
      { type: "evidence", id: "ev-frame-b", label: "Schermata +1:01:40" },
      { type: "episode", id: "episode-B", label: "interruption" },
      { type: "episode", id: "episode-A", label: "Inserimento ordine" },
    ]);
    expect(validated.verified).toBe(true);
    expect(validated.issues.unknownCitations).toEqual(["e9", "e1", "episode-A"]);
  });

  it("marks an answer without valid citations as unverified and rejects an empty one", () => {
    const unverified = validateChatReply(
      { answer: "Non lo so.", citations: [{ id: "e42" }] },
      evidence,
      episodes,
    );
    expect(unverified).toMatchObject({ verified: false, citations: [] });
    expect(unverified.issues.unknownCitations).toEqual(["e42"]);
    expect(() => validateChatReply({ answer: " \n ", citations: [] }, evidence, episodes)).toThrow(
      OctoError,
    );
    expect(() => validateChatReply({ citations: [{ id: "e1" }] }, evidence, episodes)).toThrow(
      "no answer",
    );
  });
});
