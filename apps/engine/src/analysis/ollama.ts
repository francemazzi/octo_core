import { MODEL_CALL_TIMEOUT_MS } from "@octo/contracts";
import { DEFAULT_FRAME_SPAN_MS } from "../domain/frame-timeline.js";
import { OctoError } from "../errors.js";
import { frameTimeline, type AnalysisProfile, type ModelAdapter } from "./model-adapter.js";
import { EPISODES_PROMPT_SCHEMA, EPISODES_SYSTEM_PROMPT, userPrompt } from "./prompt.js";
import { readReply } from "./reply.js";

export const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
const PREFERRED_MODELS = [
  "qwen2.5:7b-instruct-q4_K_M",
  "llama3.1:8b",
  "qwen3.5:4b",
  "qwen2.5-coder:1.5b",
];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
/** Models that read images or build embeddings: never used to group activities. */
const NON_CHAT_MODEL = /^(?:bge-|nomic-embed|llava|bakllava|moondream)|(?:^|[-_.])ocr(?:$|[-_.:])/i;
/** Ollama names its cloud models `name:cloud` or `name:<size>-cloud`. */
const CLOUD_TAG = /(?:^|[-:])cloud$/i;

export type OllamaStatus = { up: boolean; model: string | null };

/** One entry of `/api/tags`; cloud models carry `remote_host` / `remote_model`. */
export type OllamaTag = {
  name?: string;
  capabilities?: string[];
  remote_host?: string;
  remote_model?: string;
};

/** Which model to use: `requested` first, never one of `exclude`. */
export type ChatModelChoice = { requested?: string; exclude?: readonly string[] };

type FetchLike = typeof fetch;

export function ollamaBase(env: NodeJS.ProcessEnv): string {
  return env.OCTO_OLLAMA_URL?.trim() || DEFAULT_OLLAMA_BASE;
}

export function isLoopbackUrl(base: string): boolean {
  return URL.canParse(base) && LOOPBACK_HOSTS.has(new URL(base).hostname);
}

/** A model the local daemon forwards to ollama.com: evidence sent to it leaves this computer. */
export function isRemoteOllamaModel(tag: OllamaTag): boolean {
  if (tag.remote_host || tag.remote_model) return true;
  return CLOUD_TAG.test((tag.name ?? "").replace(/:latest$/i, ""));
}

export async function fetchOllamaTags(
  base: string,
  fetchImpl: FetchLike = fetch,
): Promise<OllamaTag[]> {
  const response = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(800) });
  if (!response.ok) throw new OctoError("model_unavailable", `ollama ${response.status}`);
  const body = (await response.json()) as { models?: OllamaTag[] };
  return body.models ?? [];
}

/** True when `name` is `wanted`, or `wanted` without a tag resolves to it. */
export function sameOllamaModel(name: string, wanted: string): boolean {
  return name === wanted || (!wanted.includes(":") && name === `${wanted}:latest`);
}

/** A chat model that runs on this computer: no cloud, embedding or image-reading model. */
export function chooseChatModel(tags: OllamaTag[], choice: ChatModelChoice = {}): string | null {
  const excluded = (name: string) =>
    (choice.exclude ?? []).some((other) => sameOllamaModel(name, other));
  const names = tags
    .filter((tag) => !isRemoteOllamaModel(tag))
    .filter((tag) => tag.capabilities?.includes("completion") !== false)
    .map((tag) => tag.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .filter((name) => !NON_CHAT_MODEL.test(name) && !excluded(name));
  const preferred = [choice.requested, ...PREFERRED_MODELS].filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
  return (
    preferred
      .map((wanted) => names.find((name) => name === wanted || name.startsWith(`${wanted}:`)))
      .find((name) => name !== undefined) ??
    names[0] ??
    null
  );
}

export async function probeOllama(
  fetchImpl: FetchLike = fetch,
  base = DEFAULT_OLLAMA_BASE,
  choice: ChatModelChoice = {},
): Promise<OllamaStatus> {
  let tags: OllamaTag[];
  try {
    tags = await fetchOllamaTags(base, fetchImpl);
  } catch {
    return { up: false, model: null };
  }
  const model = chooseChatModel(tags, choice);
  return { up: model !== null, model };
}

export async function askOllama(
  model: string,
  prompt: string,
  fetchImpl: FetchLike = fetch,
  base = DEFAULT_OLLAMA_BASE,
): Promise<string> {
  const response = await fetchImpl(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      // A full batch (200 lines of screen text plus the reply) does not fit in 8k tokens.
      options: { num_ctx: 16_384, temperature: 0.2 },
      messages: [
        { role: "system", content: EPISODES_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}`);
  const body = (await response.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (!content) throw new Error("ollama empty");
  return content;
}

export type OllamaOptions = ChatModelChoice & { fetchImpl?: FetchLike; base?: string };

export function createOllamaAdapter(options: OllamaOptions = {}): ModelAdapter {
  const base = options.base ?? DEFAULT_OLLAMA_BASE;
  if (!isLoopbackUrl(base)) {
    throw new OctoError("non_loopback_model", "local_only accepts Ollama on this computer only");
  }
  const probe = () => probeOllama(options.fetchImpl, base, options);
  return {
    provider: "ollama",
    locality: "local",
    promptSchema: EPISODES_PROMPT_SCHEMA,
    status: probe,
    async interpret(evidence, known) {
      const status = await probe();
      if (!status.model) throw new OctoError("model_unavailable", "no local Ollama model");
      const content = await askOllama(
        status.model,
        userPrompt(evidence, known),
        options.fetchImpl,
        base,
      );
      return { model: status.model, ...readReply(content, evidence, known) };
    },
  };
}

/** A non-loopback `base` leaves the local slot empty instead of sending evidence away. */
export function ollamaProfile(
  options: OllamaOptions & { maxFrameSpanMs?: number } = {},
): AnalysisProfile {
  const base = options.base ?? DEFAULT_OLLAMA_BASE;
  return {
    models: isLoopbackUrl(base) ? { local: createOllamaAdapter({ ...options, base }) } : {},
    timeline: frameTimeline(options.maxFrameSpanMs ?? DEFAULT_FRAME_SPAN_MS),
  };
}
