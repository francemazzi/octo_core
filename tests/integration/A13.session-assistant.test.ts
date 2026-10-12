import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createEngine,
  createFixtureAdapter,
  fixtureProfile,
  oracleTimeline,
  type ChatTurn,
  type Engine,
} from "@octo/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDesktop, launch } from "../helpers/desktop.js";
import { startDemo, tempEngine } from "../helpers/engine.js";

type Run = { prompt_schema: string; data_mode: string; outcome: string; provider: string };

/** The oracle session, stopped after 41 minutes and analysed by the fixture model. */
async function analysed(engine: Engine): Promise<string> {
  const { sessionId } = startDemo(engine);
  engine.replayCapture();
  engine.setMono(10_000 + 2_460_000);
  engine.stopSession();
  expect((await engine.runAnalysis("local_only")).analysis).toBe("awaiting_answer");
  return sessionId;
}

function chatRuns(engine: Engine): Run[] {
  return engine.db
    .prepare(
      `SELECT prompt_schema, data_mode, outcome, provider FROM analysis_runs
       WHERE prompt_schema LIKE 'chat@%' ORDER BY rowid`,
    )
    .all() as Run[];
}

function lastChatDetail(engine: Engine): Record<string, unknown> {
  const row = engine.db
    .prepare(
      `SELECT evidence_json FROM analysis_runs WHERE prompt_schema LIKE 'chat@%'
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get() as { evidence_json: string };
  return JSON.parse(row.evidence_json) as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

describe("A13 session assistant", () => {
  it("answers with citations the engine verified, stores the exchange, and touches no network", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network is closed")));
    const { engine } = tempEngine();
    try {
      const sessionId = await analysed(engine);
      const { message } = await engine.chatSend({
        sessionId,
        text: "Cosa ho fatto in questa sessione?",
        mode: "local_only",
      });
      expect(message).toMatchObject({
        role: "assistant",
        text: "Nella sessione risulta l'attività indicata, come mostra la prima schermata.",
        model: "mock",
        promptSchema: "chat@1",
        dataMode: "local_only",
        verified: true,
        partial: false,
      });
      expect(message.citations).toEqual([
        { type: "evidence", id: "ev-frame-a1", label: "Schermata +00:01" },
        { type: "episode", id: "episode-A", label: "Inserimento ordine cliente" },
      ]);
      const history = engine.chatHistory(sessionId);
      expect(history.map((item) => item.role)).toEqual(["user", "assistant"]);
      expect(history[0]).toMatchObject({
        text: "Cosa ho fatto in questa sessione?",
        citations: [],
        model: null,
        dataMode: "local_only",
      });
      expect(history[1]).toEqual(message);
      expect(chatRuns(engine)).toEqual([
        {
          prompt_schema: "chat@1",
          data_mode: "local_only",
          outcome: "accepted",
          provider: "fixture",
        },
      ]);
      expect(lastChatDetail(engine)).toMatchObject({
        chat: true,
        evidenceTotal: 4,
        evidenceSent: 4,
        messageId: message.messageId,
      });
      expect(engine.networkAudits()).toHaveLength(0);
      // The assistant never becomes the session's last analysis.
      expect(engine.sessionDetail(sessionId).lastRun).toMatchObject({
        outcome: "accepted",
        provider: "fixture",
      });
      expect(engine.sessionDetail(sessionId).session.analysisState).toBe("awaiting_answer");
    } finally {
      engine.close();
    }
  });

  it("drops citations that do not exist, rejects an empty answer, and refuses a running session", async () => {
    const scripts: unknown[] = [
      {
        answer: "Non trovo riscontri nel testo.",
        citations: ["e999", { type: "episode", id: "nope" }],
      },
      { answer: "   ", citations: [] },
    ];
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a13-unverified-")), {
      analysis: fixtureProfile({ chat: () => scripts.shift() }),
    });
    try {
      const sessionId = await analysed(engine);
      const { message } = await engine.chatSend({
        sessionId,
        text: "Chi era il cliente?",
        mode: "local_only",
      });
      expect(message).toMatchObject({
        verified: false,
        citations: [],
        text: "Non trovo riscontri nel testo.",
      });
      expect(lastChatDetail(engine).issues).toEqual({ unknownCitations: ["e999", "nope"] });

      await expect(
        engine.chatSend({ sessionId, text: "E allora?", mode: "local_only" }),
      ).rejects.toMatchObject({ code: "invalid_model_output" });
      expect(chatRuns(engine).map((run) => run.outcome)).toEqual(["accepted", "rejected"]);
      // A failed question is not stored: the operator can ask again.
      expect(engine.chatHistory(sessionId)).toHaveLength(2);
      expect(engine.sessionDetail(sessionId).lastRun?.outcome).toBe("accepted");

      await expect(
        engine.chatSend({ sessionId: "missing", text: "ciao", mode: "local_only" }),
      ).rejects.toMatchObject({ code: "missing_session" });
      const live = startDemo(engine).sessionId;
      await expect(
        engine.chatSend({ sessionId: live, text: "ciao", mode: "local_only" }),
      ).rejects.toMatchObject({ code: "session_active" });
    } finally {
      engine.close();
    }
  });

  it("keeps local questions local and sends the remote model only approved evidence, audited", async () => {
    const localSeen: ChatTurn[][] = [];
    const remoteSeen: ChatTurn[][] = [];
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a13-perimeter-")), {
      analysis: {
        models: {
          local: createFixtureAdapter("local", {
            chat: (messages) => {
              localSeen.push(messages);
              return { answer: "Locale.", citations: ["e1"] };
            },
          }),
          remote: createFixtureAdapter("remote", {
            chat: (messages) => {
              remoteSeen.push(messages);
              return { answer: "Remoto.", citations: ["e1"] };
            },
          }),
        },
        timeline: oracleTimeline(),
      },
    });
    try {
      const sessionId = await analysed(engine);
      await engine.chatSend({ sessionId, text: "Prima domanda", mode: "local_only" });
      expect(localSeen).toHaveLength(1);
      expect(remoteSeen).toHaveLength(0);
      expect(engine.networkAudits()).toHaveLength(0);
      expect(localSeen[0]?.at(-1)?.content).toContain("Evidence (4 of 4 screens");

      // Nothing approved yet: the remote model gets the activities but no screen text.
      const { message: dry } = await engine.chatSend({
        sessionId,
        text: "Seconda domanda",
        mode: "cloud_after_review",
      });
      expect(dry).toMatchObject({
        verified: false,
        partial: false,
        dataMode: "cloud_after_review",
      });
      expect(remoteSeen[0]?.at(-1)?.content).toContain("Evidence: none");
      expect(remoteSeen[0]?.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);

      engine.approveEvidence("ev-frame-a1");
      const { message } = await engine.chatSend({
        sessionId,
        text: "Terza domanda",
        mode: "cloud_after_review",
      });
      expect(message.citations).toEqual([
        { type: "evidence", id: "ev-frame-a1", label: "Schermata +00:01" },
      ]);
      const sent = remoteSeen[1]?.at(-1)?.content ?? "";
      expect(sent).toContain("Evidence (1 of 1 screens");
      expect(sent.match(/^- id=e\d+ /gm)).toEqual(["- id=e1 "]);
      expect(sent).toContain("order-A entry");
      expect(sent).not.toContain("interruption-B");
      expect(sent).not.toContain("code search");
      const audits = (engine.networkAudits() as Array<{ detail_json: string }>).map(
        (row) => JSON.parse(row.detail_json) as unknown,
      );
      expect(audits).toEqual([
        { evidenceIds: [], provider: "fixture" },
        { evidenceIds: ["ev-frame-a1"], provider: "fixture" },
      ]);
      expect(chatRuns(engine).map((run) => run.data_mode)).toEqual([
        "local_only",
        "cloud_after_review",
        "cloud_after_review",
      ]);
      expect(localSeen).toHaveLength(1);
    } finally {
      engine.close();
    }
  });

  it("keeps the operator's answer on the activity, in the report, and in the assistant's context", async () => {
    const seen: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "octo-a13-answers-"));
    const engine = createEngine(dir, {
      analysis: fixtureProfile({
        chat: (messages) => {
          seen.push(messages.at(-1)?.content ?? "");
          return {
            answer: "Sì, lo hai dichiarato.",
            citations: [{ type: "episode", id: "episode-A" }],
          };
        },
      }),
    });
    try {
      const sessionId = await analysed(engine);
      const [question] = engine.openQuestions();
      const answered = await engine.answerQuestion({
        questionId: question?.questionId ?? "",
        episodeId: "episode-A",
        text: "sì, stesso ordine",
      });
      expect(answered).toEqual({ status: "accepted", analysis: "completed" });
      expect(
        engine.db.prepare("SELECT operator_note FROM episodes WHERE id = 'episode-A'").get(),
      ).toEqual({
        operator_note: "sì, stesso ordine",
      });
      const detail = engine.sessionDetail(sessionId);
      expect(detail.episodes.map((episode) => [episode.episodeId, episode.operatorNote])).toEqual([
        ["episode-A", "sì, stesso ordine"],
        ["episode-B", null],
      ]);

      const destination = join(dir, "export");
      mkdirSync(destination);
      await engine.exportSession(destination, "draft");
      const xml = execFileSync(
        "unzip",
        ["-p", join(destination, "report", "riepilogo-sessione.docx"), "word/document.xml"],
        { encoding: "utf8" },
      );
      expect(xml).toContain("Dichiarazione dell");
      expect(xml).toContain("sì, stesso ordine");
      expect(xml).toContain("Inserimento ordine cliente");
      const activity = JSON.parse(
        readFileSync(
          join(destination, "attivita", "order_entry", "episode-A", "activity.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(activity).toMatchObject({
        label: "Inserimento ordine cliente",
        operatorNote: "sì, stesso ordine",
      });

      const { message } = await engine.chatSend({
        sessionId,
        text: "Era lo stesso ordine?",
        mode: "local_only",
      });
      expect(message.citations).toEqual([
        { type: "episode", id: "episode-A", label: "Inserimento ordine cliente" },
      ]);
      expect(seen[0]).toContain(" note=sì, stesso ordine");
      expect(seen[0]).toContain(
        "- [answered] episodeId=episode-A q=Questi passaggi appartengono allo stesso ordine? a=sì, stesso ordine",
      );
      expect(seen[0]).toContain("Domanda: Era lo stesso ordine?");

      // Split and merge keep the statement with the activity.
      const part = engine.splitEpisode("episode-A", 1_000_000);
      expect(
        engine.db.prepare("SELECT operator_note FROM episodes WHERE id = ?").get(part),
      ).toEqual({
        operator_note: "sì, stesso ordine",
      });
      engine.mergeEpisodes(part, "episode-A");
      expect(
        engine.db.prepare("SELECT operator_note FROM episodes WHERE id = 'episode-A'").get(),
      ).toEqual({
        operator_note: "sì, stesso ordine",
      });
    } finally {
      engine.close();
    }
  });

  it("still answers from the activities after a restart, when the screen text cannot be read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octo-a13-restart-"));
    const first = createEngine(dir);
    const sessionId = await analysed(first);
    first.close();
    // A new process has a new media key: the evidence of the old session is unreadable.
    const reopened = createEngine(dir);
    try {
      const { message } = await reopened.chatSend({
        sessionId,
        text: "Cosa risulta?",
        mode: "local_only",
      });
      expect(message).toMatchObject({ verified: true, partial: true });
      expect(message.citations).toEqual([
        { type: "episode", id: "episode-A", label: "Inserimento ordine cliente" },
      ]);
      expect(lastChatDetail(reopened)).toMatchObject({
        evidenceTotal: 4,
        evidenceSent: 0,
        unreadable: 4,
        issues: { unknownCitations: ["e1"] },
      });
    } finally {
      reopened.close();
    }
  });

  it("answers from the dashboard with a verified screenshot citation", async () => {
    buildDesktop();
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a13-desktop-"));
    const app = await launch(dataDir, { OCTO_MODEL: "fixture" });
    try {
      const page = await app.firstWindow();
      const active = page.getByRole("region", { name: "Sessione attiva" });
      await active.getByRole("checkbox", { name: "Schermo 1" }).check();
      await active.getByRole("button", { name: "Avvia", exact: true }).click();
      await active.getByRole("button", { name: "Stop", exact: true }).click();
      await active.getByText("Nessuna sessione attiva").waitFor();

      const assistant = page.getByRole("region", { name: "Assistente della sessione" });
      await assistant
        .getByRole("textbox", { name: "Domanda per l'assistente" })
        .fill("Cosa c'era sullo schermo?");
      await assistant.getByRole("button", { name: "Chiedi" }).click();
      await assistant.getByText("Schermata +00:01").waitFor({ timeout: 60_000 });
      await assistant.getByText("Cosa c'era sullo schermo?").waitFor();
      expect(await assistant.getByText("non verificata").count()).toBe(0);
      expect(await assistant.getByText("Contesto parziale", { exact: false }).count()).toBe(0);
    } finally {
      await app.close();
    }
    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const rows = db
      .prepare("SELECT role, verified, data_mode FROM chat_messages ORDER BY rowid")
      .all();
    const network = db
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'network'")
      .get();
    db.close();
    expect(rows).toEqual([
      { role: "user", verified: 1, data_mode: "local_only" },
      { role: "assistant", verified: 1, data_mode: "local_only" },
    ]);
    expect(network).toEqual({ count: 0 });
  }, 240_000);
});
