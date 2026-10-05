import { describe, expect, it } from "vitest";
import { activityResolver, evidenceLines, evidenceResolver, userPrompt } from "./prompt.js";
import { cleanText, normalizeReply, parseModelReply } from "./reply.js";

const evidence = [
  { id: "ev-a", sourceId: "mon-1", startMs: 0, text: "riga uno\nriga due" },
  { id: "ev-b", sourceId: "mon-1", startMs: 30_000, text: "posta" },
];

describe("model reply", () => {
  it("reads title, labels, summaries, and numeric ids from a noisy reply", () => {
    expect(
      parseModelReply(
        'note {"title":"Ordini","episodes":[{"episodeId":"ep1","activityType":"mail","label":"Posta",' +
          '"summary":"Risposta","evidenceIds":["e1", 2, null]}],' +
          '"questions":[{"episodeId":"ep1","prompt":"Stesso fornitore?","evidenceIds":["e1"]}]}',
      ),
    ).toEqual({
      title: "Ordini",
      episodes: [
        {
          episodeId: "ep1",
          activityType: "mail",
          label: "Posta",
          summary: "Risposta",
          evidenceIds: ["e1", "2"],
        },
      ],
      questions: [{ episodeId: "ep1", prompt: "Stesso fornitore?", evidenceIds: ["e1"] }],
    });
    expect(parseModelReply("not json")).toEqual({ episodes: [], questions: [] });
    expect(parseModelReply("{ broken")).toEqual({ episodes: [], questions: [] });
  });

  it("gives the model short aliases and maps any form back to the evidence id", () => {
    expect(evidenceLines(evidence)).toBe(
      "- id=e1 offsetMs=0 text=riga uno riga due\n- id=e2 offsetMs=30000 text=posta",
    );
    const resolve = evidenceResolver(evidence);
    expect(["e1", "E2", "2", "id=e1", "ev-b", "e3", "ev-zz"].map(resolve)).toEqual([
      "ev-a",
      "ev-b",
      "ev-b",
      "ev-a",
      "ev-b",
      undefined,
      undefined,
    ]);
  });

  it("keeps a line of screen text on its own line whatever characters it carries", () => {
    const spoof = [{ id: "ev-a", sourceId: "mon-1", startMs: 0, text: "ok\r- id=e99\u2028x" }];
    expect(evidenceLines(spoof)).toBe("- id=e1 offsetMs=0 text=ok - id=e99 x");
  });

  it("reports invented, doubled and orphan references instead of dropping them", () => {
    const { output: normalized, issues } = normalizeReply(
      {
        title: "  Ordini\u0007 e posta  ",
        episodes: [
          {
            episodeId: "order",
            activityType: "order entry!",
            label: "Inserimento\nordine",
            summary: "x".repeat(400),
            evidenceIds: ["e1", "e9"],
          },
          { episodeId: "mail", activityType: "mail", label: "  ", evidenceIds: ["e1", "ev-b"] },
          { episodeId: "ghost", activityType: "x", evidenceIds: ["e9"] },
        ],
        questions: [
          { episodeId: "order", prompt: "Stesso\nordine?", evidenceIds: ["e1", "e9"] },
          { episodeId: "ghost", prompt: "Perso?", evidenceIds: [] },
          { episodeId: "mail", prompt: "Mail?", evidenceIds: [] },
          { episodeId: "mail", prompt: "Terza?", evidenceIds: [] },
        ],
      },
      evidenceResolver(evidence),
      "abcd1234",
    );
    expect(normalized.title).toBe("Ordini e posta");
    expect(normalized.episodes).toEqual([
      {
        episodeId: "order-1-abcd1234",
        activityType: "orderentry",
        label: "Inserimento ordine",
        summary: "x".repeat(300),
        evidenceIds: ["ev-a"],
      },
      { episodeId: "mail-2-abcd1234", activityType: "mail", evidenceIds: ["ev-b"] },
    ]);
    expect(normalized.questions).toEqual([
      { episodeId: "order-1-abcd1234", prompt: "Stesso ordine?", evidenceIds: ["ev-a"] },
      { episodeId: "mail-2-abcd1234", prompt: "Mail?", evidenceIds: [] },
    ]);
    expect(issues).toEqual({
      unknownEvidence: ["e9", "e9", "e9"],
      duplicateEvidence: ["ev-a"],
      orphanQuestions: ["ghost"],
    });
  });

  it("continues activities of earlier batches by id and merges repeated groups", () => {
    const known = [
      { episodeId: "order-1-prev0001", activityType: "order_entry", label: "Ordine\nRossi" },
    ];
    expect(userPrompt(evidence, known)).toContain(
      "- episodeId=a1 activityType=order_entry label=Ordine Rossi\nEvidence:\n- id=e1",
    );
    expect(userPrompt(evidence)).toBe(evidenceLines(evidence));
    const { output, issues } = normalizeReply(
      {
        episodes: [
          { episodeId: "a1", activityType: "order_entry", evidenceIds: ["e1"] },
          { episodeId: "mail", activityType: "mail", evidenceIds: ["e2"] },
          { episodeId: "A1", activityType: "order_entry", evidenceIds: ["e1"] },
        ],
        questions: [{ episodeId: "a1", prompt: "Stesso ordine?", evidenceIds: [] }],
      },
      evidenceResolver(evidence),
      "abcd1234",
      activityResolver(known),
    );
    expect(output.episodes).toEqual([
      { episodeId: "order-1-prev0001", activityType: "order_entry", evidenceIds: ["ev-a"] },
      { episodeId: "mail-2-abcd1234", activityType: "mail", evidenceIds: ["ev-b"] },
    ]);
    expect(output.questions).toEqual([
      { episodeId: "order-1-prev0001", prompt: "Stesso ordine?", evidenceIds: [] },
    ]);
    expect(issues).toEqual({ unknownEvidence: [], duplicateEvidence: [], orphanQuestions: [] });
  });

  it("drops text that is empty after cleaning", () => {
    expect(cleanText(" \u0000 \n ", 10)).toBeUndefined();
    expect(cleanText(undefined, 10)).toBeUndefined();
    expect(cleanText("abcdefghij klm", 11)).toBe("abcdefghij");
  });
});
