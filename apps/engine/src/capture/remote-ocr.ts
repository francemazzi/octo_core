import type { RemoteModelConfig, RemoteProvider } from "@octo/contracts";
import { transcribeAnthropicImage, type AnthropicOptions } from "../analysis/anthropic.js";
import { transcribeOpenRouterImage, type OpenRouterOptions } from "../analysis/openrouter.js";

/** A screenshot transcript is short: the local reader stops at the same budget. */
const OCR_MAX_TOKENS = 1_024;

/** Reads one screenshot and returns text. The caller discards the image. */
export type ScreenTranscriber = {
  readonly provider: RemoteProvider;
  transcribe(imageBase64: string): Promise<string>;
};

export type RemoteOcrEndpoints = {
  openRouterBase?: string;
  anthropicBase?: string;
};

/** The configured provider, and only that one: the other key is not tried. */
export function screenTranscriber(
  config: RemoteModelConfig,
  endpoints: RemoteOcrEndpoints = {},
): ScreenTranscriber {
  if (config.provider === "anthropic") {
    const options: AnthropicOptions = {
      apiKey: config.apiKey,
      model: config.model,
      workspaceId: config.workspaceId,
      maxTokens: OCR_MAX_TOKENS,
      baseUrl: endpoints.anthropicBase,
    };
    return {
      provider: "anthropic",
      transcribe: (image) => transcribeAnthropicImage(options, image),
    };
  }
  const options: OpenRouterOptions = {
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: OCR_MAX_TOKENS,
    baseUrl: endpoints.openRouterBase,
  };
  return {
    provider: "openrouter",
    transcribe: (image) => transcribeOpenRouterImage(options, image),
  };
}
