import { randomUUID } from "node:crypto";
import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
  isInterrupted,
} from "@langchain/langgraph";
import { loadModelOutputFixture, loadSessionOracle } from "@octo/test-fixtures";
import { summarizeAssignedTime, type Stretch } from "../domain/time.js";
import type { Sql } from "../storage/db.js";
import { NodeSqliteSaver } from "./checkpointer.js";
import { acceptModelOutput, evidenceIdsForMode, type DataMode } from "./policy.js";
import { askProactiveQuestion } from "./questions.js";

const GraphState = Annotation.Root({
  sessionId: Annotation<string>,
  projectId: Annotation<string>,
  mode: Annotation<string>,
  stage: Annotation<string>,
});

export type AnalysisRunResult = {
  interrupted: boolean;
  analysis: string;
  questionCount: number;
};

type SessionRow = {
  id: string;
  project_id: string;
  capture_state: string;
  analysis_state: string;
  scope_json: string;
  policy_version: string;
};

export async function runSessionGraph(
  db: Sql,
  session: SessionRow,
  mode: DataMode,
  nowMs: number,
): Promise<AnalysisRunResult> {
  const oracle = loadSessionOracle();
  const checkpointer = new NodeSqliteSaver(db);
  const threadId = `${session.project_id}/${session.id}/${session.policy_version}`;

  const graph = new StateGraph(GraphState)
    .addNode("prepare", () => ({ stage: "prepare" }))
    .addNode("interpret", () => {
      const evidence = db
        .prepare("SELECT id, review_state, session_id FROM evidence WHERE session_id = ?")
        .all(session.id) as Array<{ id: string; review_state: string; session_id: string }>;
      const ids = evidenceIdsForMode(
        mode,
        session.id,
        evidence.map((item) => ({
          id: item.id,
          reviewState: item.review_state,
          sessionId: item.session_id,
        })),
      );
      if (mode !== "local_only") {
        db.prepare(
          `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
           VALUES (?, ?, ?, 'network', ?)`,
        ).run(
          randomUUID(),
          session.id,
          new Date().toISOString(),
          JSON.stringify({ evidenceIds: ids }),
        );
      }
      const known = new Set(evidence.map((item) => item.id));
      const output = acceptModelOutput(
        loadModelOutputFixture(),
        known,
        oracle.expected.humanTotalMs,
      );
      db.prepare(
        `INSERT INTO analysis_runs (
          id, session_id, model, provider, prompt_schema, evidence_json, outcome, usage_json, data_mode
        ) VALUES (?, ?, 'mock', 'fixture', 'model-output', ?, 'accepted', '{}', ?)`,
      ).run(randomUUID(), session.id, JSON.stringify(output.episodes), mode);
      return { stage: "interpret" };
    })
    .addNode("episode", () => {
      writeEpisodes(
        db,
        session.id,
        oracle.stretches as Stretch[],
        new Set(JSON.parse(session.scope_json) as string[]),
      );
      return { stage: "episode" };
    })
    .addNode("question", () => {
      const question = oracle.questions[0];
      if (!question) return { stage: "question" };
      askProactiveQuestion(db, {
        sessionId: session.id,
        episodeId: question.episodeId,
        questionId: question.id,
        prompt: question.prompt,
        evidenceIds: question.evidenceFrameIds.map((id) => `ev-${id}`),
        nowMs,
        limitPerDay: 3,
        cooldownMs: 60_000,
      });
      interrupt({ questionId: question.id });
      return { stage: "question" };
    })
    .addNode("consolidate", () => ({ stage: "consolidate" }))
    .addEdge(START, "prepare")
    .addEdge("prepare", "interpret")
    .addEdge("interpret", "episode")
    .addEdge("episode", "question")
    .addEdge("question", "consolidate")
    .addEdge("consolidate", END)
    .compile({ checkpointer });

  let interrupted = false;
  try {
    const result = await graph.invoke(
      { sessionId: session.id, projectId: session.project_id, mode, stage: "start" },
      { configurable: { thread_id: threadId } },
    );
    interrupted = isInterrupted(result);
  } catch (error) {
    if (!isGraphInterrupt(error)) throw error;
    interrupted = true;
  }
  db.prepare("UPDATE sessions SET analysis_state = ? WHERE id = ?").run(
    interrupted ? "awaiting_answer" : "completed",
    session.id,
  );
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM questions WHERE session_id = ?")
    .get(session.id) as { count: number };
  return {
    interrupted,
    analysis: interrupted ? "awaiting_answer" : "completed",
    questionCount: count.count,
  };
}

function writeEpisodes(
  db: Sql,
  sessionId: string,
  stretches: Stretch[],
  authorized: Set<string>,
): void {
  const summary = summarizeAssignedTime(stretches, authorized);
  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM episodes WHERE session_id = ?")
    .get(sessionId) as {
    count: number;
  };
  if (existing.count > 0) return;
  const types: Record<string, string> = { "episode-A": "order_entry", "episode-B": "interruption" };
  for (const [episodeId, durationMs] of Object.entries(summary.byEpisodeMs)) {
    db.prepare(
      `INSERT INTO episodes (id, session_id, activity_type, case_id, objective, review_state, duration_ms)
       VALUES (?, ?, ?, NULL, ?, 'proposed', ?)`,
    ).run(
      episodeId,
      sessionId,
      types[episodeId] ?? "activity",
      `Attività ${episodeId}`,
      durationMs,
    );
    for (const stretch of stretches) {
      if (stretch.episodeId !== episodeId || stretch.assignment === "secondary") continue;
      if (stretch.kind === "declared_wait" || stretch.kind === "unknown") continue;
      for (const interval of stretch.intervals) {
        if (!authorized.has(interval.sourceId)) continue;
        db.prepare(
          `INSERT INTO episode_intervals (
            id, episode_id, session_id, source_id, start_ms, end_ms, assignment, origin
          ) VALUES (?, ?, ?, ?, ?, ?, 'primary', 'oracle')`,
        ).run(
          randomUUID(),
          episodeId,
          sessionId,
          interval.sourceId,
          interval.startMs,
          interval.endMs,
        );
      }
    }
  }
  db.prepare(
    `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
     VALUES (?, ?, ?, 'time_summary', ?)`,
  ).run(randomUUID(), sessionId, new Date().toISOString(), JSON.stringify(summary));
}

export function threadIdFor(projectId: string, sessionId: string, policyVersion: string): string {
  return `${projectId}/${sessionId}/${policyVersion}`;
}
