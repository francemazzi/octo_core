import { loadModelOutputFixture, loadSessionOracle } from "@octo/test-fixtures";
import type { Stretch } from "../domain/time.js";
import type {
  AnalysisProfile,
  ModelAdapter,
  ModelLocality,
  TimelineBuilder,
} from "./model-adapter.js";

export function createFixtureAdapter(locality: ModelLocality): ModelAdapter {
  return {
    provider: "fixture",
    locality,
    promptSchema: "model-output@1",
    status: () => Promise.resolve({ up: true, model: "mock" }),
    interpret: () => Promise.resolve({ model: "mock", raw: fixtureOutput() }),
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

export function fixtureProfile(): AnalysisProfile {
  return {
    models: { local: createFixtureAdapter("local"), remote: createFixtureAdapter("remote") },
    timeline: oracleTimeline(),
  };
}
