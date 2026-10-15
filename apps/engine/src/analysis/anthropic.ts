import { MODEL_CALL_TIMEOUT_MS } from "@octo/contracts";
import { z } from "zod";
import { OctoError } from "../errors.js";
import type { ChatTurn, ConverseReply, ModelAdapter } from "./model-adapter.js";
import { EPISODES_PROMPT_SCHEMA, EPISODES_SYSTEM_PROMPT, userPrompt } from "./prompt.js";
import { readReply } from "./reply.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4_000;
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export type AnthropicOptions = {
  apiKey: string;
  workspaceId?: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};
const messageSchema = z.object({
  model: z.string(),
  stop_reason: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
});

async function request(options: AnthropicOptions, path: string, body?: unknown): Promise<Response> {
  if (!options.apiKey) throw new OctoError("model_unavailable", "Anthropic key is missing");
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${options.baseUrl ?? ANTHROPIC_BASE_URL}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-api-key": options.apiKey,
          ...(options.workspaceId ? { "anthropic-workspace-id": options.workspaceId } : {}),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(body === undefined ? 15_000 : MODEL_CALL_TIMEOUT_MS),
        redirect: "error",
      },
    );
  } catch {
    throw new OctoError("remote_unreachable", "Anthropic could not be reached");
  }
  if (response.status === 401 || response.status === 403)
    throw new OctoError("invalid_key", "Anthropic refused the key");
  if (response.status === 404)
    throw new OctoError("model_unavailable", "Anthropic model is unavailable");
  if (response.status === 429 || response.status >= 500)
    throw new OctoError("remote_unreachable", `Anthropic answered ${response.status}`);
  if (response.status === 400 && !options.workspaceId) {
    const body: unknown = await response.json().catch(() => null);
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (error.success && error.data.error.message.includes("anthropic-workspace-id")) {
      throw new OctoError("workspace_required", "Anthropic requires a workspace ID for this key");
    }
  }
  if (!response.ok) throw new OctoError("remote_rejected", `Anthropic answered ${response.status}`);
  return response;
}

/** Authentication only: no evidence or paid generation. */
export async function verifyAnthropicKey(options: AnthropicOptions): Promise<void> {
  await request(options, "/models?limit=1");
}

/** One Messages API call; a `stop_reason` other than `end_turn` is an incomplete reply. */
async function complete(
  options: AnthropicOptions,
  model: string,
  system: string,
  messages: ChatTurn[],
): Promise<ConverseReply> {
  const response = await request(options, "/messages", {
    model,
    max_tokens: options.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    system,
    messages,
  });
  const parsed = messageSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.stop_reason !== "end_turn") {
    throw new OctoError(
      "invalid_model_output",
      "Anthropic returned an incomplete or invalid message",
    );
  }
  const body = parsed.data;
  return {
    model: body.model,
    content: body.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n"),
    usage: {
      prompt_tokens: body.usage.input_tokens,
      completion_tokens: body.usage.output_tokens,
      total_tokens: body.usage.input_tokens + body.usage.output_tokens,
    },
  };
}

/** One screenshot, transcribed and discarded. No tools, no episode prompt, no stored image. */
export async function transcribeAnthropicImage(
  options: AnthropicOptions,
  imageBase64: string,
): Promise<string> {
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const response = await request(options, "/messages", {
    model,
    max_tokens: options.maxTokens ?? 1_024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
          },
          { type: "text", text: "Text Recognition:" },
        ],
      },
    ],
  });
  const parsed = messageSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.stop_reason !== "end_turn") {
    throw new OctoError("invalid_model_output", "Anthropic returned an incomplete transcript");
  }
  return parsed.data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function createAnthropicAdapter(options: AnthropicOptions): ModelAdapter {
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  return {
    provider: "anthropic",
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    locality: "remote",
    promptSchema: EPISODES_PROMPT_SCHEMA,
    status: async () => ({ up: options.apiKey.length > 0, model }),
    async interpret(evidence, known) {
      const reply = await complete(options, model, EPISODES_SYSTEM_PROMPT, [
        { role: "user", content: userPrompt(evidence, known) },
      ]);
      return {
        model: reply.model,
        ...readReply(reply.content, evidence, known),
        usage: reply.usage,
      };
    },
    converse: (system, messages) => complete(options, model, system, messages),
  };
}
