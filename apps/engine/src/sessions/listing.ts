import type { SessionDetail, SessionEpisode, SessionListItem } from "@octo/contracts";
import { listOpenQuestions, OPEN_QUESTION_SQL } from "../analysis/questions.js";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";
import { sessionDurationMs } from "./clock.js";

type SessionRow = {
  id: string;
  title: string | null;
  started_wall: string;
  ended_wall: string | null;
  capture_state: SessionListItem["captureState"];
  analysis_state: SessionListItem["analysisState"];
  scope_json: string;
  epoch_id: string;
  episode_count: number;
  open_questions: number;
};

const SESSION_SELECT = `SELECT s.id, s.title, s.started_wall, s.ended_wall, s.capture_state,
  s.analysis_state, s.scope_json, s.epoch_id,
  (SELECT COUNT(*) FROM episodes e WHERE e.session_id = s.id) AS episode_count,
  (SELECT COUNT(*) FROM questions q WHERE q.session_id = s.id AND q.${OPEN_QUESTION_SQL}) AS open_questions
  FROM sessions s`;

function toItem(db: Sql, row: SessionRow): SessionListItem {
  return {
    sessionId: row.id,
    title: row.title,
    startedWall: row.started_wall,
    endedWall: row.ended_wall,
    captureState: row.capture_state,
    analysisState: row.analysis_state,
    durationMs: sessionDurationMs(db, row.id, row.epoch_id),
    episodeCount: row.episode_count,
    openQuestionCount: row.open_questions,
    sourceIds: JSON.parse(row.scope_json) as string[],
  };
}

/** Newest first, for the sidebar. */
export function listSessions(db: Sql, limit = 100): SessionListItem[] {
  const rows = db
    .prepare(`${SESSION_SELECT} ORDER BY s.started_wall DESC LIMIT ?`)
    .all(limit) as SessionRow[];
  return rows.map((row) => toItem(db, row));
}

/** One session with its activities in time order, its open questions and the last analysis. */
export function sessionDetail(db: Sql, sessionId: string): SessionDetail {
  const row = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(sessionId) as
    SessionRow | undefined;
  if (!row) throw new OctoError("missing_session", sessionId);
  const episodes = db
    .prepare(
      `SELECT e.id AS episodeId, e.label, e.summary, e.activity_type AS activityType,
         e.duration_ms AS durationMs, e.review_state AS reviewState
       FROM episodes e LEFT JOIN episode_intervals i ON i.episode_id = e.id
       WHERE e.session_id = ? GROUP BY e.id
       ORDER BY MIN(i.start_ms) IS NULL, MIN(i.start_ms), e.id`,
    )
    .all(sessionId) as SessionEpisode[];
  const run = db
    .prepare(
      `SELECT outcome, model, json_extract(evidence_json, '$.error') AS error FROM analysis_runs
       WHERE session_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get(sessionId) as { outcome: string; model: string; error: string | null } | undefined;
  return {
    session: toItem(db, row),
    episodes: episodes.map((episode) => ({ ...episode })),
    questions: listOpenQuestions(db, { sessionId }),
    lastRun: run ? { ...run } : null,
  };
}
