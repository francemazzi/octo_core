import { loadModelOutputFixture, loadSessionOracle } from "@octo/test-fixtures";
import type { Stretch } from "../domain/time.js";
import type {
  AnalysisProfile,
  ChatTurn,
  ModelAdapter,
  ModelLocality,
  TimelineBuilder,
} from "./model-adapter.js";

/** What the fixture assistant replies, given the conversation it received. */
export type ChatScript = (messages: ChatTurn[]) => unknown;

export type FixtureOptions = { chat?: ChatScript };

/** Answers in Italian, citing the first screenshot and the first activity of the last turn. */
export function defaultChatScript(messages: ChatTurn[]): unknown {
  const last = messages.at(-1)?.content ?? "";
  const episodeId = /episodeId=(\S+)/.exec(last)?.[1];
  return {
    answer: "Nella sessione risulta l'attività indicata, come mostra la prima schermata.",
    citations: [
      { type: "evidence", id: "e1" },
      ...(episodeId ? [{ type: "episode", id: episodeId }] : []),
    ],
  };
}

export function createFixtureAdapter(
  locality: ModelLocality,
  options: FixtureOptions = {},
): ModelAdapter {
  const script = options.chat ?? defaultChatScript;
  return {
    provider: "fixture",
    locality,
    promptSchema: "model-output@2",
    status: () => Promise.resolve({ up: true, model: "mock" }),
    interpret: () => Promise.resolve({ model: "mock", raw: fixtureOutput() }),
    converse: (_system, messages) =>
      Promise.resolve({ model: "mock", content: JSON.stringify(script(messages)) }),
  };
}

function fixtureOutput(): unknown {
  const output = loadModelOutputFixture() as Record<string, unknown>;
  const questions = loadSessionOracle().questions.map((question) => ({
    episodeId: question.episodeId,
    prompt: question.prompt,
    evidenceIds: question.evidenceFrameIds.map((frameId) => `ev-${frameId}`),
  }));
  return { ...output, questions };
}

export function oracleTimeline(): TimelineBuilder {
  const stretches = loadSessionOracle().stretches as Stretch[];
  return () => stretches;
}

export function fixtureProfile(options: FixtureOptions = {}): AnalysisProfile {
  return {
    models: {
      local: createFixtureAdapter("local", options),
      remote: createFixtureAdapter("remote", options),
    },
    timeline: oracleTimeline(),
  };
}
