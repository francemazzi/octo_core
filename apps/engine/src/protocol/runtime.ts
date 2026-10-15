import { remoteProviderSchema, type RemoteModelConfig, type RemoteProvider } from "@octo/contracts";
import {
  createAnthropicAdapter,
  verifyAnthropicKey,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
} from "../analysis/anthropic.js";
import { z } from "zod";
import { fixtureProfile } from "../analysis/fixture-adapter.js";
import {
  frameTimeline,
  type AnalysisProfile,
  type ModelAdapter,
} from "../analysis/model-adapter.js";
import {
  createOllamaAdapter,
  isLoopbackUrl,
  LIGHT_CHAT_MODEL,
  ollamaBase,
} from "../analysis/ollama.js";
import {
  createOpenRouterAdapter,
  DEFAULT_OPENROUTER_MAX_TOKENS,
  verifyOpenRouterKey,
} from "../analysis/openrouter.js";
import type { RemoteModels } from "../analysis/remote-slot.js";
import { createOllamaOcr, DEFAULT_OCR_MODEL, type OcrReader } from "../capture/ocr.js";
import { screenTranscriber } from "../capture/remote-ocr.js";
import type { EngineOptions } from "../create-engine.js";
import { HostKeyProvider } from "../crypto/key-provider.js";
import { DEFAULT_FRAME_SPAN_MS } from "../domain/frame-timeline.js";
import { OctoError } from "../errors.js";
import type { OllamaWiring } from "../readiness/status.js";

const positiveIntSchema = z.coerce.number().int().positive();

/**
 * Options for the engine process: real clocks, the local model chosen by `OCTO_MODEL`, and
 * The selected cloud provider is wired only when its API key is set.
 */
export function runtimeOptions(env: NodeJS.ProcessEnv = process.env): EngineOptions {
  return {
    nowMono: () => Math.round(performance.now()),
    nowWall: () => new Date().toISOString(),
    // The desktop keeps the media key in the system keystore and hands it over (`keys.unlock`).
    ...(env.OCTO_KEY_SOURCE === "host" ? { keyProvider: new HostKeyProvider() } : {}),
    ...modelWiring(env),
  };
}

/** The models of the engine process without its clocks, so tests can drive time. */
export function modelWiring(
  env: NodeJS.ProcessEnv,
): Pick<EngineOptions, "analysis" | "remoteModels" | "ocr" | "ollama"> {
  return {
    analysis: analysisProfile(env),
    remoteModels: remoteModels(env),
    ocr: ocrReader(env),
    ollama: ollamaWiring(env),
  };
}

/** Ollama on this computer, for readiness and downloads; nothing when it is not loopback. */
export function ollamaWiring(env: NodeJS.ProcessEnv): OllamaWiring | undefined {
  const base = ollamaBase(env);
  if (!isLoopbackUrl(base)) return undefined;
  return { base, chatModel: env.OCTO_OLLAMA_MODEL?.trim() || LIGHT_CHAT_MODEL };
}

/** Screenshots are read by a local vision model unless `OCTO_OCR=off`. */
export function ocrReader(env: NodeJS.ProcessEnv): OcrReader | undefined {
  const base = ollamaBase(env);
  if (env.OCTO_OCR === "off" || !isLoopbackUrl(base)) return undefined;
  return createOllamaOcr({ base, model: ocrModel(env) });
}

/**
 * `OCTO_MODEL=fixture` replays the test fixture; `off` leaves no local model. The remote slot
 * is independent of the local slot and uses only the selected provider’s key.
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
  const selected = env.OCTO_REMOTE_PROVIDER?.trim();
  const provider = selected
    ? remoteProviderSchema.parse(selected)
    : env.OPENROUTER_API_KEY?.trim()
      ? "openrouter"
      : "anthropic";
  return remoteModels(env).environment?.(provider);
}

export function remoteModels(env: NodeJS.ProcessEnv): RemoteModels {
  const baseUrl = openRouterBase(env);
  const anthropicBase = providerBase(env, "OCTO_ANTHROPIC_URL");
  const maxTokens = positiveInt(env, "OPENROUTER_MAX_TOKENS", DEFAULT_OPENROUTER_MAX_TOKENS);
  const anthropicMax = positiveInt(env, "ANTHROPIC_MAX_TOKENS", DEFAULT_ANTHROPIC_MAX_TOKENS);
  const endpoints = { openRouterBase: baseUrl, anthropicBase };
  const models: RemoteModels = {
    create: (config) =>
      config.provider === "anthropic"
        ? createAnthropicAdapter({ ...config, maxTokens: anthropicMax, baseUrl: anthropicBase })
        : createOpenRouterAdapter({ ...config, maxTokens, baseUrl }),
    transcribe: (config) => screenTranscriber(config, endpoints),
    verify: (config) =>
      config.provider === "anthropic"
        ? verifyAnthropicKey({ ...config, baseUrl: anthropicBase })
        : verifyOpenRouterKey(config.apiKey, { baseUrl }),
    environment: (provider: RemoteProvider) => {
      const config = remoteConfig(env, provider);
      return config ? models.create(config) : undefined;
    },
    environmentTranscriber: (provider) => {
      const config = remoteConfig(env, provider);
      return config ? screenTranscriber(config, endpoints) : undefined;
    },
  };
  return models;
}

/** The environment key of one provider. Absent when that provider has no key. */
function remoteConfig(
  env: NodeJS.ProcessEnv,
  provider: RemoteProvider,
): RemoteModelConfig | undefined {
  const prefix = provider === "anthropic" ? "ANTHROPIC" : "OPENROUTER";
  const apiKey = env[`${prefix}_API_KEY`]?.trim();
  if (!apiKey) return undefined;
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return {
    provider,
    apiKey,
    model: env[`${prefix}_MODEL`]?.trim() || undefined,
    ...(provider === "anthropic" && workspaceId ? { workspaceId } : {}),
  };
}

/** Test seam: `OCTO_OPENROUTER_URL` may only point to a fake server on this computer. */
export function openRouterBase(env: NodeJS.ProcessEnv): string | undefined {
  return providerBase(env, "OCTO_OPENROUTER_URL");
}

function providerBase(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  if (!isLoopbackUrl(raw)) {
    throw new OctoError("invalid_config", `${name} must point to this computer`);
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
