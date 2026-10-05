import { describe, expect, it } from "vitest";
import { knownActivities, mergeOutputs, planBatches, textCharsFor } from "./batches.js";

describe("analysis batches", () => {
  it("covers the session in time order and says how much was not sent", () => {
    const rows = Array.from({ length: 450 }, (_, index) => index);
    const all = planBatches(rows, 200, 10);
    expect(all.batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(all.batches.flat()).toEqual(rows);
    expect(all).toMatchObject({ evidenceTotal: 450, evidenceSent: 450 });

    const capped = planBatches(rows, 200, 2);
    expect(capped).toMatchObject({ evidenceTotal: 450, evidenceSent: 400 });
    expect(planBatches([], 200, 10)).toEqual({ batches: [], evidenceTotal: 0, evidenceSent: 0 });
  });

  it("keeps the text of a batch within the prompt budget", () => {
    expect(textCharsFor(10)).toBe(500);
    expect(textCharsFor(200)).toBe(120);
    expect(textCharsFor(100, 4_000)).toBe(200);
  });

  it("joins continued activities and keeps the first title, labels and two questions", () => {
    const merged = mergeOutputs([
      {
        title: "Ordini",
        episodes: [
          { episodeId: "order", activityType: "order_entry", evidenceIds: ["e1"] },
          { episodeId: "mail", activityType: "mail", label: "Posta", evidenceIds: ["e2"] },
        ],
        questions: [{ episodeId: "order", prompt: "Stesso cliente?", evidenceIds: [] }],
      },
      {
        title: "Altro",
        episodes: [
          {
            episodeId: "order",
            activityType: "order_entry",
            label: "Ordine Rossi",
            evidenceIds: ["e3"],
          },
        ],
        questions: [
          { episodeId: "order", prompt: "Stesso cliente?", evidenceIds: [] },
          { episodeId: "mail", prompt: "Fornitore?", evidenceIds: [] },
          { episodeId: "order", prompt: "Terza?", evidenceIds: [] },
        ],
      },
    ]);
    expect(merged.title).toBe("Ordini");
    expect(merged.episodes).toEqual([
      {
        episodeId: "order",
        activityType: "order_entry",
        label: "Ordine Rossi",
        evidenceIds: ["e1", "e3"],
      },
      { episodeId: "mail", activityType: "mail", label: "Posta", evidenceIds: ["e2"] },
    ]);
    expect(merged.questions?.map((question) => question.prompt)).toEqual([
      "Stesso cliente?",
      "Fornitore?",
    ]);
    expect(knownActivities(merged)).toEqual([
      { episodeId: "order", activityType: "order_entry", label: "Ordine Rossi" },
      { episodeId: "mail", activityType: "mail", label: "Posta" },
    ]);
  });
});
