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
import type { AnalysisProfile, ModelStatus } from "./model-adapter.js";
import type { DataMode } from "./policy.js";
import {
  answerQuestion,
  deferQuestion,
  findQuestion,
  listOpenQuestions,
  type QuestionRow,
} from "./questions.js";

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
    const row = db
      .prepare(
        `SELECT model FROM analysis_runs WHERE session_id = ? AND outcome = 'accepted'
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(sessionId) as { model: string } | undefined;
    return row?.model ?? null;
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
    };
  }

  function move(sessionId: string, from: AnalysisState, to: AnalysisState): AnalysisState {
    assertAnalysisTransition(from, to);
    db.prepare("UPDATE sessions SET analysis_state = ? WHERE id = ?").run(to, sessionId);
    return to;
  }

  /** Runs the graph between `running` and its outcome; a finished or crashed run passes `pending`. */
  async function execute(
    session: GraphSession,
    mode: DataMode,
    invoke: () => Promise<GraphRun>,
  ): Promise<AnalysisResult> {
    const from = stored(session.id).analysis_state;
    const ready =
      from === "completed" || from === "running" ? move(session.id, from, "pending") : from;
    move(session.id, ready, "running");
    db.prepare("UPDATE sessions SET data_mode = ? WHERE id = ?").run(mode, session.id);
    let run;
    try {
      run = await invoke();
    } catch (error) {
      move(session.id, "running", "pending");
      throw error;
    }
    const analysis: AnalysisOutcome = run.interrupted
      ? "awaiting_answer"
      : run.reason === "accepted"
        ? "completed"
        : "pending";
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
