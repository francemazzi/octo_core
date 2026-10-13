import { describe, expect, it } from "vitest";
import { UNREADABLE_TEXT } from "../shared/readiness-text.js";
import { analysisNote } from "./notes.js";

const report = { issued: false, path: null };

describe("analysis note", () => {
  it("names the local model instead of guessing that Ollama is off", () => {
    expect(analysisNote({ reason: "accepted", episodes: 2, model: "qwen3.5:4b" }, report)).toBe(
      "Modello locale: qwen3.5:4b. Attività riconosciute: 2.",
    );
    expect(analysisNote({ reason: "model_unavailable", episodes: 0 }, report)).toBe(
      "Nessun modello locale disponibile (Ollama spento o senza modello). Nessuna attività riconosciuta.",
    );
    expect(analysisNote({ reason: "model_error", episodes: 0 }, report)).toBe(
      "Il modello locale non ha risposto. Nessuna attività riconosciuta.",
    );
  });

  it("says when nothing was read and when a session can no longer be read", () => {
    expect(analysisNote({ reason: "no_evidence", episodes: 0 }, report)).toBe(
      "Nessuna schermata letta. Nessuna attività riconosciuta.",
    );
    expect(analysisNote({ reason: "unreadable_evidence", episodes: 0 }, report)).toBe(
      `${UNREADABLE_TEXT} Nessuna attività riconosciuta.`,
    );
    expect(
      analysisNote(
        { reason: "model_error", episodes: 0 },
        report,
        "cloud_after_review",
        "OpenRouter",
      ),
    ).toBe("OpenRouter non ha risposto. Nessuna attività riconosciuta.");
  });
});
