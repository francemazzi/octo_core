import { MODEL_CALL_TIMEOUT_MS } from "@octo/contracts";
import { OctoError } from "../errors.js";
import type { ModelAdapter } from "./model-adapter.js";
import { EPISODES_PROMPT_SCHEMA, EPISODES_SYSTEM_PROMPT, userPrompt } from "./prompt.js";
import { readReply } from "./reply.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "mistralai/mistral-small-3.2-24b-instruct";
/** A full batch of 200 evidence already needs ~1 400 reply tokens: keep room for summaries. */
export const DEFAULT_OPENROUTER_MAX_TOKENS = 4_000;

const USAGE_FIELDS = ["prompt_tokens", "completion_tokens", "total_tokens", "cost"] as const;

type FetchLike = typeof fetch;

export type OpenRouterOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Defaults to OpenRouter; tests point it to a fake server on this computer. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

type CompletionBody = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: Record<string, unknown>;
};

/**
 * Remote model for the cloud modes. The graph only hands it the evidence perimeter of the mode,
 * and routing is limited to providers that neither store nor train on the data.
 */
export function createOpenRouterAdapter(options: OpenRouterOptions): ModelAdapter {
  const model = options.model ?? DEFAULT_OPENROUTER_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_OPENROUTER_MAX_TOKENS;
  return {
    provider: "openrouter",
    locality: "remote",
    promptSchema: EPISODES_PROMPT_SCHEMA,
    status: () => Promise.resolve({ up: options.apiKey.length > 0, model }),
    async interpret(evidence, known) {
      if (options.apiKey.length === 0) {
        throw new OctoError("model_unavailable", "OPENROUTER_API_KEY is missing");
      }
      const fetchImpl = options.fetchImpl ?? fetch;
      const body = await transient(async () => {
        const response = await fetchImpl(
          `${options.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              "content-type": "application/json",
              "x-title": "Octo Core",
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              temperature: 0,
              response_format: { type: "json_object" },
              provider: { data_collection: "deny", zdr: true, require_parameters: true },
              messages: [
                { role: "system", content: EPISODES_SYSTEM_PROMPT },
                { role: "user", content: userPrompt(evidence, known) },
              ],
            }),
            signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
          },
        );
        if (response.status === 429 || response.status >= 500) {
          throw new OctoError("remote_unreachable", `openrouter ${response.status}`);
        }
        if (!response.ok) throw new Error(`openrouter ${response.status}`);
        return (await response.json()) as CompletionBody;
      });
      const content = body.choices?.[0]?.message?.content ?? "";
      return {
        model: body.model ?? model,
        ...readReply(content, evidence, known),
        usage: usageOf(body.usage),
      };
    },
  };
}

/**
 * A dropped connection (`fetch failed`, `terminated`) is worth one more try, like 429 and 5xx;
 * a refused key or missing credit is not.
 */
async function transient<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new OctoError("remote_unreachable", error.message.slice(0, 100));
  }
}

/**
 * Checks a key with OpenRouter (`GET /key`): no evidence is sent. Errors never repeat the key.
 */
export async function verifyOpenRouterKey(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl ?? OPENROUTER_BASE_URL}/key`, {
      headers: { authorization: `Bearer ${apiKey}`, "x-title": "Octo Core" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OctoError("remote_unreachable", "OpenRouter could not be reached");
  }
  if (response.status === 401 || response.status === 403) {
    throw new OctoError("invalid_key", "OpenRouter refused the key");
  }
  if (!response.ok) {
    throw new OctoError("remote_unreachable", `OpenRouter answered ${response.status}`);
  }
}

function usageOf(usage: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of USAGE_FIELDS) {
    const value = usage?.[field];
    if (typeof value === "number") out[field] = value;
  }
  return out;
}
