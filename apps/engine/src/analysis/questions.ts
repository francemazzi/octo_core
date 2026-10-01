import { randomUUID } from "node:crypto";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";

const DAY_MS = 86_400_000;

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
  const mismatch =
    !question || question.episode_id !== input.episodeId || question.status !== "open";
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

export function deferQuestion(db: Sql, questionId: string): void {
  const row = db.prepare("SELECT id FROM questions WHERE id = ?").get(questionId) as
    { id: string } | undefined;
  if (!row) throw new OctoError("missing_question", questionId);
  db.prepare("UPDATE questions SET status = 'deferred' WHERE id = ?").run(questionId);
}
