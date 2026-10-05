import { z } from "zod";
import { fixtureProfile } from "../analysis/fixture-adapter.js";
import {
  frameTimeline,
  type AnalysisProfile,
  type ModelAdapter,
} from "../analysis/model-adapter.js";
import { createOllamaAdapter, isLoopbackUrl, ollamaBase } from "../analysis/ollama.js";
import {
  createOpenRouterAdapter,
  DEFAULT_OPENROUTER_MAX_TOKENS,
  verifyOpenRouterKey,
} from "../analysis/openrouter.js";
import type { RemoteModels } from "../analysis/remote-slot.js";
import { createOllamaOcr, DEFAULT_OCR_MODEL, type OcrReader } from "../capture/ocr.js";
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
    ...modelWiring(env),
  };
}

/** The models of the engine process without its clocks, so tests can drive time. */
export function modelWiring(
  env: NodeJS.ProcessEnv,
): Pick<EngineOptions, "analysis" | "remoteModels" | "ocr"> {
  return { analysis: analysisProfile(env), remoteModels: remoteModels(env), ocr: ocrReader(env) };
}

/** Screenshots are read by a local vision model unless `OCTO_OCR=off`. */
export function ocrReader(env: NodeJS.ProcessEnv): OcrReader | undefined {
  const base = ollamaBase(env);
  if (env.OCTO_OCR === "off" || !isLoopbackUrl(base)) return undefined;
  return createOllamaOcr({ base, model: ocrModel(env) });
}

/**
 * `OCTO_MODEL=fixture` replays the test fixture; `off` leaves no local model. The remote slot
 * depends only on `OPENROUTER_API_KEY`, so the cloud modes stay available with either.
 */
export function analysisProfile(env: NodeJS.ProcessEnv): AnalysisProfile {
  const maxFrameSpanMs = positiveInt(env, "OCTO_FRAME_SPAN_MS", DEFAULT_FRAME_SPAN_MS);
  if (env.OCTO_MODEL === "fixture") return fixtureProfile();
  const remote = remoteModel(env);
  return {
    models: { local: localModel(env), ...(remote ? { remote } : {}) },
    timeline: frameTimeline(maxFrameSpanMs),
  };
}

/** Ollama on this computer only: a non-loopback `OCTO_OLLAMA_URL` leaves the slot empty. */
function localModel(env: NodeJS.ProcessEnv): ModelAdapter | undefined {
  const base = ollamaBase(env);
  if (env.OCTO_MODEL === "off" || !isLoopbackUrl(base)) return undefined;
  return createOllamaAdapter({
    base,
    requested: env.OCTO_OLLAMA_MODEL?.trim() || undefined,
    exclude: [ocrModel(env)],
  });
}

function ocrModel(env: NodeJS.ProcessEnv): string {
  return env.OCTO_OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
}

function remoteModel(env: NodeJS.ProcessEnv): ModelAdapter | undefined {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
  if (apiKey === "") return undefined;
  const model = env.OPENROUTER_MODEL?.trim() || undefined;
  return remoteModels(env).create({ provider: "openrouter", apiKey, model });
}

/** OpenRouter for a key from the environment at start, or one the operator sets in the app. */
export function remoteModels(env: NodeJS.ProcessEnv): RemoteModels {
  const baseUrl = openRouterBase(env);
  const maxTokens = positiveInt(env, "OPENROUTER_MAX_TOKENS", DEFAULT_OPENROUTER_MAX_TOKENS);
  return {
    create: (config) =>
      createOpenRouterAdapter({ apiKey: config.apiKey, model: config.model, maxTokens, baseUrl }),
    verify: (config) => verifyOpenRouterKey(config.apiKey, { baseUrl }),
  };
}

/** Test seam: `OCTO_OPENROUTER_URL` may only point to a fake server on this computer. */
export function openRouterBase(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.OCTO_OPENROUTER_URL?.trim();
  if (!raw) return undefined;
  if (!isLoopbackUrl(raw)) {
    throw new OctoError("invalid_config", "OCTO_OPENROUTER_URL must point to this computer");
  }
  return raw.replace(/\/+$/, "");
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = positiveIntSchema.safeParse(raw);
  if (!parsed.success) throw new OctoError("invalid_config", `${name} must be a positive integer`);
  return parsed.data;
}
