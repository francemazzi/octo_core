import { randomUUID } from "node:crypto";
import { OctoError } from "../errors.js";
import type { ModelAdapter } from "./model-adapter.js";
import {
  EPISODES_PROMPT_SCHEMA,
  EPISODES_SYSTEM_PROMPT,
  evidenceLines,
  evidenceResolver,
} from "./prompt.js";
import { normalizeReply, parseModelReply } from "./reply.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "mistralai/mistral-small-3.2-24b-instruct";
export const DEFAULT_OPENROUTER_MAX_TOKENS = 1_500;

const USAGE_FIELDS = ["prompt_tokens", "completion_tokens", "total_tokens", "cost"] as const;

type FetchLike = typeof fetch;

export type OpenRouterOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
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
    async interpret(evidence) {
      if (options.apiKey.length === 0) {
        throw new OctoError("model_unavailable", "OPENROUTER_API_KEY is missing");
      }
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(OPENROUTER_URL, {
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
            { role: "user", content: evidenceLines(evidence) },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`openrouter ${response.status}`);
      const body = (await response.json()) as CompletionBody;
      const content = body.choices?.[0]?.message?.content ?? "";
      return {
        model: body.model ?? model,
        raw: normalizeReply(
          parseModelReply(content),
          evidenceResolver(evidence),
          randomUUID().slice(0, 8),
        ),
        usage: usageOf(body.usage),
      };
    },
  };
}

function usageOf(usage: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of USAGE_FIELDS) {
    const value = usage?.[field];
    if (typeof value === "number") out[field] = value;
  }
  return out;
}
