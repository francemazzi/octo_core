import { z } from "zod";
import { fixtureProfile } from "../analysis/fixture-adapter.js";
import {
  frameTimeline,
  type AnalysisProfile,
  type ModelAdapter,
} from "../analysis/model-adapter.js";
import { isLoopbackUrl, ollamaBase, ollamaProfile } from "../analysis/ollama.js";
import { createOpenRouterAdapter, DEFAULT_OPENROUTER_MAX_TOKENS } from "../analysis/openrouter.js";
import { createOllamaOcr, type OcrReader } from "../capture/ocr.js";
import type { EngineOptions } from "../create-engine.js";
import { DEFAULT_FRAME_SPAN_MS } from "../domain/frame-timeline.js";
import { OctoError } from "../errors.js";

const positiveIntSchema = z.coerce.number().int().positive();

/**
 * Options for the engine process: real clocks, the local model chosen by `OCTO_MODEL`, and
 * OpenRouter as the remote model for the cloud modes when `OPENROUTER_API_KEY` is set.
 */
export function runtimeOptions(env: NodeJS.ProcessEnv = process.env): EngineOptions {
  return {
    nowMono: () => Math.round(performance.now()),
    nowWall: () => new Date().toISOString(),
    analysis: analysisProfile(env),
    ocr: ocrReader(env),
  };
}

/** Screenshots are read by a local vision model unless `OCTO_OCR=off`. */
export function ocrReader(env: NodeJS.ProcessEnv): OcrReader | undefined {
  if (env.OCTO_OCR === "off" || !isLoopbackUrl(ollamaBase())) return undefined;
  return createOllamaOcr({ model: env.OCTO_OCR_MODEL?.trim() || undefined });
}

export function analysisProfile(env: NodeJS.ProcessEnv): AnalysisProfile {
  const maxFrameSpanMs = positiveInt(env, "OCTO_FRAME_SPAN_MS", DEFAULT_FRAME_SPAN_MS);
  if (env.OCTO_MODEL === "off") return { models: {}, timeline: frameTimeline(maxFrameSpanMs) };
  if (env.OCTO_MODEL === "fixture") return fixtureProfile();
  const local = ollamaProfile({ maxFrameSpanMs });
  return { ...local, models: { ...local.models, remote: remoteModel(env) } };
}

function remoteModel(env: NodeJS.ProcessEnv): ModelAdapter | undefined {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
  if (apiKey === "") return undefined;
  return createOpenRouterAdapter({
    apiKey,
    model: env.OPENROUTER_MODEL?.trim() || undefined,
    maxTokens: positiveInt(env, "OPENROUTER_MAX_TOKENS", DEFAULT_OPENROUTER_MAX_TOKENS),
  });
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = positiveIntSchema.safeParse(raw);
  if (!parsed.success) throw new OctoError("invalid_config", `${name} must be a positive integer`);
  return parsed.data;
}
