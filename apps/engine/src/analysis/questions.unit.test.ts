import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";
import {
  answerQuestion,
  askProactiveQuestion,
  deferQuestion,
  listOpenQuestions,
  questionIdFor,
} from "./questions.js";

function db() {
  const dir = mkdtempSync(join(tmpdir(), "octo-q-"));
  return openDatabase(join(dir, "octo.db"));
}

describe("question quota", () => {
  it("asks at most three proactive questions per day and quarantines a cross-episode answer", () => {
    const database = db();
    database
      .prepare(
        `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
       VALUES ('p', 'demo', 'local', '{}', '{}', '2026-01-15T00:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO sessions (
        id, project_id, operator_pseudonym, started_wall, capture_state, analysis_state,
        scope_json, policy_version, epoch_id
      ) VALUES ('s', 'p', 'op', '2026-01-15T00:00:00.000Z', 'recording', 'idle', '[]', 'mvp-1', 'e')`,
      )
      .run();

    const base = {
      sessionId: "s",
      episodeId: "episode-A",
      prompt: "Stesso ordine?",
      evidenceIds: ["ev-1"],
      limitPerDay: 3,
      cooldownMs: 0,
    };
    expect(askProactiveQuestion(database, { ...base, questionId: "q1", nowMs: 1_000 }).asked).toBe(
      true,
    );
    expect(askProactiveQuestion(database, { ...base, questionId: "q2", nowMs: 2_000 }).asked).toBe(
      true,
    );
    expect(askProactiveQuestion(database, { ...base, questionId: "q3", nowMs: 3_000 }).asked).toBe(
      true,
    );
    expect(askProactiveQuestion(database, { ...base, questionId: "q4", nowMs: 4_000 }).reason).toBe(
      "daily_limit",
    );
    expect(askProactiveQuestion(database, { ...base, questionId: "q1", nowMs: 5_000 }).reason).toBe(
      "duplicate",
    );

    const quarantined = answerQuestion(database, {
      questionId: "q1",
      episodeId: "episode-B",
      text: "no",
      nowIso: "2026-01-15T01:00:00.000Z",
    });
    expect(quarantined.status).toBe("quarantined");

    deferQuestion(database, "q2");
    expect(listOpenQuestions(database).map((row) => [row.questionId, row.status])).toEqual([
      ["q3", "open"],
      ["q2", "deferred"],
      ["q1", "open"],
    ]);
    const later = answerQuestion(database, {
      questionId: "q2",
      episodeId: "episode-A",
      text: "sì",
      nowIso: "2026-01-15T02:00:00.000Z",
    });
    expect(later.status).toBe("accepted");
    deferQuestion(database, "q2");
    expect(listOpenQuestions(database).some((row) => row.questionId === "q2")).toBe(false);
  });

  it("derives question ids from session, episode, and prompt", () => {
    const id = questionIdFor("s1", "episode-A", "Stesso ordine?");
    expect(id).toMatch(/^q-[a-f0-9]{16}$/);
    expect(questionIdFor("s1", "episode-A", "Stesso ordine?")).toBe(id);
    expect(questionIdFor("s2", "episode-A", "Stesso ordine?")).not.toBe(id);
  });
});
