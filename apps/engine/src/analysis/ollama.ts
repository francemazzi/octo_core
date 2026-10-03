import { randomUUID } from "node:crypto";
import { DEFAULT_FRAME_SPAN_MS } from "../domain/frame-timeline.js";
import { OctoError } from "../errors.js";
import { frameTimeline, type AnalysisProfile, type ModelAdapter } from "./model-adapter.js";
import {
  EPISODES_PROMPT_SCHEMA,
  EPISODES_SYSTEM_PROMPT,
  evidenceLines,
  normalizeReply,
  parseModelReply,
} from "./reply.js";

const DEFAULT_BASE = "http://127.0.0.1:11434";
const PREFERRED_MODELS = [
  "qwen2.5:7b-instruct-q4_K_M",
  "llama3.1:8b",
  "qwen3.5:4b",
  "qwen2.5-coder:1.5b",
];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export type OllamaStatus = { up: boolean; model: string | null };

type FetchLike = typeof fetch;

export function ollamaBase(): string {
  return process.env.OCTO_OLLAMA_URL ?? DEFAULT_BASE;
}

export function isLoopbackUrl(base: string): boolean {
  return URL.canParse(base) && LOOPBACK_HOSTS.has(new URL(base).hostname);
}

export async function probeOllama(
  fetchImpl: FetchLike = fetch,
  base = ollamaBase(),
): Promise<OllamaStatus> {
  try {
    const response = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return { up: false, model: null };
    const body = (await response.json()) as {
      models?: Array<{ name?: string; capabilities?: string[] }>;
    };
    const names = (body.models ?? [])
      .filter((model) => model.capabilities?.includes("completion") !== false)
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .filter((name) => !name.startsWith("bge-") && !name.startsWith("nomic-embed"));
    const requested = process.env.OCTO_OLLAMA_MODEL;
    const preferred = [requested, ...PREFERRED_MODELS].filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
    const model =
      preferred
        .map((wanted) => names.find((name) => name === wanted || name.startsWith(`${wanted}:`)))
        .find((name) => name !== undefined) ??
      names[0] ??
      null;
    return { up: model !== null, model };
  } catch {
    return { up: false, model: null };
  }
}

export async function askOllama(
  model: string,
  prompt: string,
  fetchImpl: FetchLike = fetch,
  base = ollamaBase(),
): Promise<string> {
  const response = await fetchImpl(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: EPISODES_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}`);
  const body = (await response.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (!content) throw new Error("ollama empty");
  return content;
}

export function createOllamaAdapter(
  options: { fetchImpl?: FetchLike; base?: string } = {},
): ModelAdapter {
  const base = options.base ?? ollamaBase();
  if (!isLoopbackUrl(base)) {
    throw new OctoError("non_loopback_model", "local_only accepts Ollama on this computer only");
  }
  return {
    provider: "ollama",
    locality: "local",
    promptSchema: EPISODES_PROMPT_SCHEMA,
    status: () => probeOllama(options.fetchImpl, base),
    async interpret(evidence) {
      const status = await probeOllama(options.fetchImpl, base);
      if (!status.model) throw new OctoError("model_unavailable", "Ollama is not running");
      const content = await askOllama(
        status.model,
        evidenceLines(evidence),
        options.fetchImpl,
        base,
      );
      const known = new Set(evidence.map((item) => item.id));
      const raw = normalizeReply(parseModelReply(content), known, randomUUID().slice(0, 8));
      return { model: status.model, raw };
    },
  };
}

/** A non-loopback `OCTO_OLLAMA_URL` leaves the local slot empty instead of sending evidence away. */
export function ollamaProfile(
  options: { fetchImpl?: FetchLike; base?: string; maxFrameSpanMs?: number } = {},
): AnalysisProfile {
  const base = options.base ?? ollamaBase();
  return {
    models: isLoopbackUrl(base)
      ? { local: createOllamaAdapter({ fetchImpl: options.fetchImpl, base }) }
      : {},
    timeline: frameTimeline(options.maxFrameSpanMs ?? DEFAULT_FRAME_SPAN_MS),
  };
}
