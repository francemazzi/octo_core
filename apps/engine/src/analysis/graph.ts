import { randomUUID } from "node:crypto";
import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { ModelOutput } from "@octo/contracts";
import { z } from "zod";
import { sessionDurationMs } from "../sessions/clock.js";
import { NodeSqliteSaver } from "./checkpointer.js";
import { loadFrames, writeEpisodes } from "./episodes.js";
import { adapterFor, interpretSession, type InterpretDeps } from "./interpret.js";
import type { DataMode } from "./policy.js";
import { askProactiveQuestion, findQuestion, questionIdFor, questionLimits } from "./questions.js";

const GraphState = Annotation.Root({
  sessionId: Annotation<string>,
  projectId: Annotation<string>,
  mode: Annotation<DataMode>,
  stage: Annotation<string>,
  reason: Annotation<string | null>,
  model: Annotation<string | null>,
  output: Annotation<ModelOutput | null>,
  questionId: Annotation<string | null>,
});

type State = typeof GraphState.State;

export type GraphSession = {
  id: string;
  project_id: string;
  scope_json: string;
  policy_version: string;
  epoch_id: string;
};

export type GraphRun = {
  interrupted: boolean;
  reason: string | null;
  model: string | null;
};

export function threadIdFor(projectId: string, sessionId: string, policyVersion: string): string {
  return `${projectId}/${sessionId}/${policyVersion}`;
}

function buildSessionGraph(deps: InterpretDeps) {
  const { db } = deps;
  const session = (sessionId: string) =>
    db.prepare("SELECT scope_json, epoch_id FROM sessions WHERE id = ?").get(sessionId) as {
      scope_json: string;
      epoch_id: string;
    };

  return new StateGraph(GraphState)
    .addNode("prepare", () => ({ stage: "prepare" }))
    .addNode("interpret", async (state: State) => {
      const result = await interpretSession(deps, {
        sessionId: state.sessionId,
        mode: state.mode,
        windowMs: sessionDurationMs(db, state.sessionId, session(state.sessionId).epoch_id),
      });
      return { stage: "interpret", ...result };
    })
    .addNode("episode", (state: State) => {
      if (!state.output) return { stage: "episode" };
      const row = session(state.sessionId);
      const authorizedSourceIds = JSON.parse(row.scope_json) as string[];
      writeEpisodes(db, {
        sessionId: state.sessionId,
        output: state.output,
        stretches: deps.profile.timeline({
          output: state.output,
          frames: loadFrames(db, state.sessionId, row.epoch_id),
          sessionEndMs: sessionDurationMs(db, state.sessionId, row.epoch_id),
          authorizedSourceIds,
        }),
        authorized: new Set(authorizedSourceIds),
        origin: adapterFor(deps.profile, state.mode)?.provider ?? "model",
        wallTime: deps.nowWall(),
      });
      return { stage: "episode" };
    })
    .addNode("question", (state: State) => {
      const proposal = state.output?.questions?.[0];
      if (!proposal) return { stage: "question", questionId: null };
      const questionId = questionIdFor(state.sessionId, proposal.episodeId, proposal.prompt);
      // This node runs again on resume: every effect before interrupt() must be idempotent.
      const existing = findQuestion(db, questionId);
      if (existing?.status === "answered") return { stage: "question", questionId };
      if (!existing) {
        const asked = askProactiveQuestion(db, {
          sessionId: state.sessionId,
          episodeId: proposal.episodeId,
          questionId,
          prompt: proposal.prompt,
          evidenceIds: proposal.evidenceIds,
          nowMs: Date.parse(deps.nowWall()),
          ...questionLimits(db, state.projectId),
        });
        if (!asked.asked) return { stage: "question", questionId: null };
      }
      interrupt({ questionId });
      return { stage: "question", questionId };
    })
    .addNode("consolidate", (state: State) => {
      const question = state.questionId ? findQuestion(db, state.questionId) : undefined;
      db.prepare(
        `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
         VALUES (?, ?, ?, 'analysis_completed', ?)`,
      ).run(
        randomUUID(),
        state.sessionId,
        deps.nowWall(),
        JSON.stringify({ questionId: state.questionId, questionStatus: question?.status ?? null }),
      );
      return { stage: "consolidate" };
    })
    .addEdge(START, "prepare")
    .addEdge("prepare", "interpret")
    .addConditionalEdges("interpret", (state: State) => (state.output ? "episode" : END), [
      "episode",
      END,
    ])
    .addEdge("episode", "question")
    .addEdge("question", "consolidate")
    .addEdge("consolidate", END)
    .compile({ checkpointer: new NodeSqliteSaver(db) });
}

function threadOf(session: GraphSession): { thread_id: string } {
  return { thread_id: threadIdFor(session.project_id, session.id, session.policy_version) };
}

const pendingValueSchema = z.object({ questionId: z.string() });

export type PendingQuestion = { questionId: string; mode: DataMode };

/** The question the thread is waiting on, read from the checkpoint. */
export async function pendingInterrupt(
  deps: InterpretDeps,
  session: GraphSession,
): Promise<PendingQuestion | null> {
  const snapshot = await buildSessionGraph(deps).getState({ configurable: threadOf(session) });
  if (snapshot.next.length === 0) return null;
  const mode = (snapshot.values as Partial<State>).mode;
  const value = snapshot.tasks.flatMap((task) => task.interrupts).map((item) => item.value)[0];
  const parsed = pendingValueSchema.safeParse(value);
  if (!parsed.success || !mode) return null;
  return { questionId: parsed.data.questionId, mode };
}

/** Starts a fresh run on the session thread; every channel is reset by the input. */
export function runSessionGraph(
  deps: InterpretDeps,
  session: GraphSession,
  mode: DataMode,
): Promise<GraphRun> {
  const input: State = {
    sessionId: session.id,
    projectId: session.project_id,
    mode,
    stage: "start",
    reason: null,
    model: null,
    output: null,
    questionId: null,
  };
  return invokeGraph(deps, session, (graph, config) => graph.invoke(input, config));
}

/** Continues the waiting thread after an accepted answer. The resume value is always an object. */
export function resumeSessionGraph(
  deps: InterpretDeps,
  session: GraphSession,
  resume: { questionId: string; outcome: "answered" },
): Promise<GraphRun> {
  return invokeGraph(deps, session, (graph, config) =>
    graph.invoke(new Command({ resume }), config),
  );
}

type SessionGraph = ReturnType<typeof buildSessionGraph>;
type InvokeConfig = { configurable: { thread_id: string }; durability: "sync" };

async function invokeGraph(
  deps: InterpretDeps,
  session: GraphSession,
  invoke: (graph: SessionGraph, config: InvokeConfig) => Promise<unknown>,
): Promise<GraphRun> {
  const graph = buildSessionGraph(deps);
  const configurable = threadOf(session);
  await invoke(graph, { configurable, durability: "sync" });
  const snapshot = await graph.getState({ configurable });
  const values = snapshot.values as Partial<State>;
  return {
    interrupted: snapshot.next.length > 0,
    reason: values.reason ?? null,
    model: values.model ?? null,
  };
}
