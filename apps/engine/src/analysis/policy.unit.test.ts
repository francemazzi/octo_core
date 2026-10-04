import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { acceptModelOutput } from "./policy.js";

const known = new Set(["ev-a", "ev-b"]);

function codeOf(raw: unknown): string | null {
  try {
    acceptModelOutput(raw, known, 60_000);
    return null;
  } catch (error) {
    if (error instanceof OctoError) return error.code;
    throw error;
  }
}

describe("acceptModelOutput", () => {
  it("accepts episodes without durationMs and questions tied to them", () => {
    const output = acceptModelOutput(
      {
        episodes: [{ episodeId: "ep1", activityType: "order_entry", evidenceIds: ["ev-a"] }],
        questions: [{ episodeId: "ep1", prompt: "È lo stesso ordine?", evidenceIds: ["ev-a"] }],
      },
      known,
      60_000,
    );
    expect(output.episodes[0]?.durationMs).toBeUndefined();
    expect(output.questions).toHaveLength(1);
  });

  it("rejects evidence assigned to two episodes", () => {
    expect(
      codeOf({
        episodes: [
          { episodeId: "ep1", activityType: "a", evidenceIds: ["ev-a"] },
          { episodeId: "ep2", activityType: "b", evidenceIds: ["ev-a"] },
        ],
      }),
    ).toBe("duplicate_evidence");
  });

  it("rejects questions about unknown episodes or evidence", () => {
    const episodes = [{ episodeId: "ep1", activityType: "a", evidenceIds: ["ev-a"] }];
    expect(
      codeOf({ episodes, questions: [{ episodeId: "ep9", prompt: "?", evidenceIds: [] }] }),
    ).toBe("unknown_episode");
    expect(
      codeOf({ episodes, questions: [{ episodeId: "ep1", prompt: "?", evidenceIds: ["ev-x"] }] }),
    ).toBe("unknown_evidence");
  });

  it("rejects question prompts with control characters or over the length cap", () => {
    const episodes = [{ episodeId: "ep1", activityType: "a", evidenceIds: ["ev-a"] }];
    const question = (prompt: string) => ({
      episodes,
      questions: [{ episodeId: "ep1", prompt, evidenceIds: [] }],
    });
    expect(codeOf(question("riga\u0007suono"))).toBe("invalid_model_output");
    expect(codeOf(question("x".repeat(301)))).toBe("invalid_model_output");
  });

  it("bounds the Italian labels, summaries, and session title written by the model", () => {
    const episode = { episodeId: "ep1", activityType: "a", evidenceIds: ["ev-a"] };
    expect(
      codeOf({ title: "Ordini", episodes: [{ ...episode, label: "Ordine", summary: "Fatto." }] }),
    ).toBeNull();
    expect(codeOf({ episodes: [{ ...episode, label: "riga\u0000due" }] })).toBe(
      "invalid_model_output",
    );
    expect(codeOf({ episodes: [{ ...episode, summary: "x".repeat(301) }] })).toBe(
      "invalid_model_output",
    );
    expect(codeOf({ title: "x".repeat(81), episodes: [episode] })).toBe("invalid_model_output");
  });
});
