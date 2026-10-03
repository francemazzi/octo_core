import { randomUUID } from "node:crypto";
import { sha256 } from "../crypto/aes.js";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";

const DAY_MS = 86_400_000;

/** Question ids are scoped to the session, so two sessions never share a question row. */
export function questionIdFor(sessionId: string, episodeId: string, prompt: string): string {
  return `q-${sha256(`${sessionId}|${episodeId}|${prompt}`).slice(0, 16)}`;
}

export function questionLimits(
  db: Sql,
  projectId: string,
): { limitPerDay: number; cooldownMs: number } {
  const row = db
    .prepare("SELECT question_limit_per_day, question_cooldown_ms FROM projects WHERE id = ?")
    .get(projectId) as { question_limit_per_day: number; question_cooldown_ms: number } | undefined;
  return {
    limitPerDay: row?.question_limit_per_day ?? 3,
    cooldownMs: row?.question_cooldown_ms ?? 60_000,
  };
}

export function askProactiveQuestion(
  db: Sql,
  input: {
    sessionId: string;
    episodeId: string;
    questionId: string;
    prompt: string;
    evidenceIds: string[];
    nowMs: number;
    limitPerDay: number;
    cooldownMs: number;
  },
): { asked: boolean; reason?: string } {
  const existing = db.prepare("SELECT id FROM questions WHERE id = ?").get(input.questionId) as
    { id: string } | undefined;
  if (existing) return { asked: false, reason: "duplicate" };

  const dayStart = input.nowMs - (input.nowMs % DAY_MS);
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS count FROM questions
       WHERE origin = 'proactive' AND asked_at_ms >= ?`,
    )
    .get(dayStart) as { count: number };
  if (recent.count >= input.limitPerDay) return { asked: false, reason: "daily_limit" };

  const last = db
    .prepare(
      "SELECT asked_at_ms FROM questions WHERE origin = 'proactive' ORDER BY asked_at_ms DESC LIMIT 1",
    )
    .get() as { asked_at_ms: number } | undefined;
  if (last && input.nowMs - last.asked_at_ms < input.cooldownMs) {
    return { asked: false, reason: "cooldown" };
  }

  db.prepare(
    `INSERT INTO questions (
      id, session_id, episode_id, prompt, evidence_json, status, version, asked_at_ms, origin
    ) VALUES (?, ?, ?, ?, ?, 'open', 1, ?, 'proactive')`,
  ).run(
    input.questionId,
    input.sessionId,
    input.episodeId,
    input.prompt,
    JSON.stringify(input.evidenceIds),
    input.nowMs,
  );
  return { asked: true };
}

export function answerQuestion(
  db: Sql,
  input: { questionId: string; episodeId: string; text: string; nowIso: string },
): { status: "accepted" | "quarantined" } {
  const question = db
    .prepare("SELECT id, episode_id, status FROM questions WHERE id = ?")
    .get(input.questionId) as { id: string; episode_id: string; status: string } | undefined;
  const answerable = question?.status === "open" || question?.status === "deferred";
  const mismatch = !question || question.episode_id !== input.episodeId || !answerable;
  const status = mismatch ? "quarantined" : "accepted";
  db.prepare(
    `INSERT INTO answers (id, question_id, episode_id, text, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), input.questionId, input.episodeId, input.text, status, input.nowIso);
  if (status === "accepted" && question) {
    db.prepare("UPDATE questions SET status = 'answered' WHERE id = ?").run(question.id);
  }
  return { status };
}

/** Deferring postpones an open question: it stays answerable and the graph keeps waiting. */
export function deferQuestion(db: Sql, questionId: string): void {
  const row = db.prepare("SELECT id FROM questions WHERE id = ?").get(questionId) as
    { id: string } | undefined;
  if (!row) throw new OctoError("missing_question", questionId);
  db.prepare("UPDATE questions SET status = 'deferred' WHERE id = ? AND status = 'open'").run(
    questionId,
  );
}

export type QuestionRow = {
  questionId: string;
  sessionId: string;
  episodeId: string;
  prompt: string;
  status: string;
  askedAtMs: number;
};

export function findQuestion(db: Sql, questionId: string): QuestionRow | undefined {
  return db
    .prepare(
      `SELECT id AS questionId, session_id AS sessionId, episode_id AS episodeId, prompt, status,
       asked_at_ms AS askedAtMs FROM questions WHERE id = ?`,
    )
    .get(questionId) as QuestionRow | undefined;
}

/** Questions still waiting for the operator, newest first, across sessions. */
export function listOpenQuestions(db: Sql, limit = 20): QuestionRow[] {
  return db
    .prepare(
      `SELECT id AS questionId, session_id AS sessionId, episode_id AS episodeId, prompt, status,
       asked_at_ms AS askedAtMs FROM questions WHERE status IN ('open', 'deferred')
       ORDER BY asked_at_ms DESC LIMIT ?`,
    )
    .all(limit) as QuestionRow[];
}
