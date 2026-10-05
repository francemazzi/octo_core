import { OctoError } from "../errors.js";
import { assertAnalysisTransition, type AnalysisState } from "../sessions/machine.js";
import type { Sql } from "../storage/db.js";
import {
  pendingInterrupt,
  resumeSessionGraph,
  runSessionGraph,
  type GraphRun,
  type GraphSession,
  type PendingQuestion,
} from "./graph.js";
import { hasReviewedEpisodes } from "./episodes.js";
import type { AnalysisProfile, ModelStatus } from "./model-adapter.js";
import type { DataMode } from "./policy.js";
import {
  answerQuestion,
  deferQuestion,
  findQuestion,
  listOpenQuestions,
  type QuestionRow,
} from "./questions.js";
import { latestRun } from "./runs.js";

export type AnalysisServiceDeps = {
  db: Sql;
  profile: AnalysisProfile;
  readText: (assetId: string) => string;
  nowWall: () => string;
  requireSession: () => GraphSession;
};

export type AnalysisOutcome = "awaiting_answer" | "completed" | "pending";

export type AnalysisResult = {
  analysis: AnalysisOutcome;
  reason: string | null;
  model: string | null;
  interrupted: boolean;
  episodes: number;
  questionCount: number;
  capture: string;
  /** Some evidence of the session was not sent to the model (session too long). */
  partial: boolean;
};

export type AnswerResult = { status: "accepted" | "quarantined"; analysis: string | null };

export function createAnalysisService(deps: AnalysisServiceDeps) {
  const { db } = deps;
  const graphDeps = {
    db,
    profile: deps.profile,
    readText: deps.readText,
    nowWall: deps.nowWall,
  };

  function loadSession(sessionId: string): GraphSession | undefined {
    return db
      .prepare(
        "SELECT id, project_id, scope_json, policy_version, epoch_id FROM sessions WHERE id = ?",
      )
      .get(sessionId) as GraphSession | undefined;
  }

  function stored(sessionId: string): { analysis_state: AnalysisState; data_mode: DataMode } {
    return db
      .prepare("SELECT analysis_state, data_mode FROM sessions WHERE id = ?")
      .get(sessionId) as { analysis_state: AnalysisState; data_mode: DataMode };
  }

  function lastModel(sessionId: string): string | null {
    return latestRun(db, sessionId, { accepted: true })?.model ?? null;
  }

  function result(
    sessionId: string,
    analysis: AnalysisOutcome,
    reason: string | null,
    model: string | null,
  ): AnalysisResult {
    const count = (table: "episodes" | "questions") =>
      (
        db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`)
          .get(sessionId) as {
          count: number;
        }
      ).count;
    const capture = db
      .prepare("SELECT capture_state FROM sessions WHERE id = ?")
      .get(sessionId) as { capture_state: string };
    return {
      analysis,
      reason,
      model,
      interrupted: analysis === "awaiting_answer",
      episodes: count("episodes"),
      questionCount: count("questions"),
      capture: capture.capture_state,
      partial: latestRun(db, sessionId)?.partial ?? false,
    };
  }

  function move(sessionId: string, from: AnalysisState, to: AnalysisState): AnalysisState {
    assertAnalysisTransition(from, to);
    db.prepare("UPDATE sessions SET analysis_state = ? WHERE id = ?").run(to, sessionId);
    return to;
  }

  /**
   * Runs the graph between `running` and its outcome; a finished or crashed run passes `pending`.
   * A failed re-analysis keeps the activities already there: the session stays `completed` in
   * its previous mode.
   */
  async function execute(
    session: GraphSession,
    mode: DataMode,
    invoke: () => Promise<GraphRun>,
  ): Promise<AnalysisResult> {
    const before = stored(session.id);
    const hadEpisodes = result(session.id, "pending", null, null).episodes > 0;
    const settle = () => {
      if (!hadEpisodes) return move(session.id, "running", "pending");
      db.prepare("UPDATE sessions SET data_mode = ? WHERE id = ?").run(
        before.data_mode,
        session.id,
      );
      return move(session.id, "running", "completed");
    };
    const from = before.analysis_state;
    const ready =
      from === "completed" || from === "running" ? move(session.id, from, "pending") : from;
    move(session.id, ready, "running");
    db.prepare("UPDATE sessions SET data_mode = ? WHERE id = ?").run(mode, session.id);
    let run;
    try {
      run = await invoke();
    } catch (error) {
      settle();
      throw error;
    }
    if (!run.interrupted && run.reason !== "accepted") {
      const settled = settle();
      return result(
        session.id,
        settled === "completed" ? "completed" : "pending",
        run.reason,
        run.model,
      );
    }
    const analysis: AnalysisOutcome = run.interrupted ? "awaiting_answer" : "completed";
    move(session.id, "running", analysis);
    return result(session.id, analysis, run.reason, run.model);
  }

  function resume(session: GraphSession, pending: PendingQuestion): Promise<AnalysisResult> {
    return execute(session, pending.mode, () =>
      resumeSessionGraph(graphDeps, session, {
        questionId: pending.questionId,
        outcome: "answered",
      }),
    );
  }

  return {
    /** Re-entrant: a waiting or finished run in the same mode never calls the model again. */
    async run(mode: DataMode, sessionId?: string): Promise<AnalysisResult> {
      const session = sessionId ? loadSession(sessionId) : deps.requireSession();
      if (!session) throw new OctoError("missing_session", sessionId ?? "none");
      const pending = await pendingInterrupt(graphDeps, session);
      if (pending?.mode === mode) {
        // An answer stored before a crash resumes now instead of waiting forever.
        if (findQuestion(db, pending.questionId)?.status === "answered") {
          return resume(session, pending);
        }
        return result(session.id, "awaiting_answer", "already_analyzed", lastModel(session.id));
      }
      const current = stored(session.id);
      if (current.analysis_state === "completed" && current.data_mode === mode) {
        return result(session.id, "completed", "already_analyzed", lastModel(session.id));
      }
      if (hasReviewedEpisodes(db, session.id)) {
        const state = current.analysis_state === "completed" ? "completed" : "pending";
        return result(session.id, state, "reviewed_session", lastModel(session.id));
      }
      return execute(session, mode, () => runSessionGraph(graphDeps, session, mode));
    },
    /** Stores the answer; an accepted answer to the question the graph waits on resumes it. */
    async answer(input: {
      questionId: string;
      episodeId: string;
      text: string;
    }): Promise<AnswerResult> {
      const question = findQuestion(db, input.questionId);
      const answered = answerQuestion(db, { ...input, nowIso: deps.nowWall() });
      const session = question ? loadSession(question.sessionId) : undefined;
      if (answered.status !== "accepted" || !session) {
        return { status: answered.status, analysis: null };
      }
      const pending = await pendingInterrupt(graphDeps, session);
      if (pending?.questionId !== input.questionId) {
        return { status: "accepted", analysis: stored(session.id).analysis_state };
      }
      const resumed = await resume(session, pending);
      return { status: "accepted", analysis: resumed.analysis };
    },
    defer(questionId: string): void {
      deferQuestion(db, questionId);
    },
    list(): QuestionRow[] {
      return listOpenQuestions(db);
    },
    modelStatus(): Promise<ModelStatus> {
      const local = deps.profile.models.local;
      return local ? local.status() : Promise.resolve({ up: false, model: null });
    },
  };
}
