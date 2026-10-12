import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "@octo/contracts";
import { describe, expect, it } from "vitest";
import { createEngine } from "../create-engine.js";
import { CHAT_SYSTEM_PROMPT, chatMessages, describeSession, evidenceBlock } from "./prompt.js";

const demo = {
  projectId: "oracle-project",
  operatorPseudonym: "op",
  sourceIds: ["mon-1", "mon-2"],
  purpose: "Inserimento ordini",
};

function message(index: number, role: ChatMessage["role"]): ChatMessage {
  return {
    messageId: `m${index}`,
    sessionId: "s",
    role,
    text: `turn ${index}`,
    citations: [],
    model: null,
    promptSchema: null,
    dataMode: null,
    verified: true,
    partial: false,
    createdAt: "2026-01-15T08:00:00.000Z",
  };
}

describe("session assistant prompt", () => {
  it("describes activities, questions, answers and the last analysis on one line each", async () => {
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-chat-prompt-")));
    try {
      const { sessionId } = engine.startSession(demo);
      engine.replayCapture();
      engine.setMono(10_000 + 2_460_000);
      engine.stopSession();
      expect((await engine.runAnalysis("local_only")).analysis).toBe("awaiting_answer");
      engine.db
        .prepare("UPDATE episodes SET label = ? WHERE id = 'episode-B'")
        .run("Risposta\ta una\nmail");

      const before = describeSession(engine.db, sessionId);
      expect(before.text).toContain("title=Inserimento ordine cliente");
      expect(before.text).toContain("durationMs=2460000 dataMode=local_only");
      expect(before.text).toContain(
        "- episodeId=episode-A activityType=order_entry label=Inserimento ordine cliente durationMs=1500000 reviewState=proposed intervals=mon-1:",
      );
      expect(before.text).toContain("label=Risposta a una mail durationMs=300000");
      expect(before.text).toContain(
        "- [open] episodeId=episode-A q=Questi passaggi appartengono allo stesso ordine?",
      );
      expect(before.text).toContain("Last analysis: outcome=accepted model=mock provider=fixture");
      expect(before.text).not.toContain("note=");
      expect(before.episodes).toEqual([
        {
          episodeId: "episode-A",
          label: "Inserimento ordine cliente",
          activityType: "order_entry",
        },
        {
          episodeId: "episode-B",
          label: "Risposta\ta una\nmail",
          activityType: "interruption",
        },
      ]);

      const [question] = engine.openQuestions();
      await engine.answerQuestion({
        questionId: question?.questionId ?? "",
        episodeId: "episode-A",
        text: "  sì,\nstesso ordine ",
      });
      const after = describeSession(engine.db, sessionId);
      expect(after.text).toContain(
        "- [answered] episodeId=episode-A q=Questi passaggi appartengono allo stesso ordine? a=  sì, stesso ordine ",
      );
      expect(after.text).not.toContain("[open]");
      expect(after.text).toContain(" note=sì, stesso ordine");
    } finally {
      engine.close();
    }
  });

  it("lists the evidence with aliases and says how much of the session it covers", () => {
    const evidence = [
      { id: "ev-1", sourceId: "mon-1", startMs: 0, text: "ordine\nRossi" },
      { id: "ev-2", sourceId: "mon-1", startMs: 30_000, text: "mail" },
    ];
    const block = evidenceBlock(evidence, { evidenceSent: 2, evidenceTotal: 5 });
    expect(block.split("\n")).toEqual([
      "Evidence (2 of 5 screens, cite as e1, e2, ...):",
      "- id=e1 offsetMs=0 text=ordine Rossi",
      "- id=e2 offsetMs=30000 text=mail",
    ]);
    expect(evidenceBlock([], { evidenceSent: 0, evidenceTotal: 0 })).toBe("Evidence: none");
  });

  it("sends the latest turns and attaches the context to the new question only", () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      message(index, index % 2 === 0 ? "user" : "assistant"),
    );
    const turns = chatMessages("Activities:\n- episodeId=a", history, "Quanto ho lavorato?");
    expect(turns).toHaveLength(11);
    expect(turns[0]).toEqual({ role: "user", content: "turn 2" });
    expect(turns.at(-2)).toEqual({ role: "assistant", content: "turn 11" });
    expect(turns.at(-1)).toEqual({
      role: "user",
      content: "Activities:\n- episodeId=a\n\nDomanda: Quanto ho lavorato?",
    });
    expect(CHAT_SYSTEM_PROMPT).toContain("untrusted data");
    expect(CHAT_SYSTEM_PROMPT).toContain('"citations"');
  });
});
