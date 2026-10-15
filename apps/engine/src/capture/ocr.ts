import { ndjsonLines } from "../analysis/ndjson.js";
import {
  asOllamaError,
  DEFAULT_OLLAMA_BASE,
  fetchOllamaTags,
  isLoopbackUrl,
  isRemoteOllamaModel,
  ollamaFetch,
  sameOllamaModel,
  type OllamaTag,
} from "../analysis/ollama.js";
import type { RemoteProvider } from "@octo/contracts";
import { OctoError } from "../errors.js";

export const DEFAULT_OCR_MODEL = "glm-ocr";
/** The only instruction sent with a screenshot: transcribe, do not interpret. */
export const OCR_PROMPT = "Text Recognition:";
const MAX_OCR_CHARS = 4_000;

type FetchLike = typeof fetch;

/** Turns a screenshot into text; the image itself is never stored. */
export interface OcrReader {
  readonly model: string;
  /**
   * Provider that transcribed the last successful read, or null when this computer did.
   * Absent on a reader that never leaves the machine.
   */
  lastVia?: RemoteProvider | null;
  read(imageBase64: string, frameId?: string): Promise<string>;
}

function squeeze(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_OCR_CHARS);
}

/**
 * glm-ocr repeats its transcript inside code fences: keep the first copy only.
 * When the only copy is the fenced one, keep that body (a leading language tag drops).
 */
export function cleanOcrText(raw: string): string {
  const [before = "", inside = ""] = raw.split("```");
  const leading = squeeze(before);
  if (leading.length > 0) return leading;
  return squeeze(inside.replace(/^[a-z0-9_+-]{1,16}\n/, ""));
}

/** Whether the OCR model is installed, and whether it runs here rather than on ollama.com. */
export function ocrModelState(
  tags: OllamaTag[],
  model: string,
): { installed: boolean; local: boolean } {
  const tag = tags.find(
    (item) => typeof item.name === "string" && sameOllamaModel(item.name, model),
  );
  return { installed: tag !== undefined, local: tag !== undefined && !isRemoteOllamaModel(tag) };
}

/**
 * The OCR model must be installed and run on this computer: the daemon forwards cloud models to
 * ollama.com. Checked before the first screenshot leaves the engine, again after a failure.
 */
async function assertLocalModel(base: string, model: string, fetchImpl: FetchLike): Promise<void> {
  const state = ocrModelState(await fetchOllamaTags(base, fetchImpl), model);
  if (!state.installed) throw new OctoError("ocr_model_missing", `${model} is not installed`);
  if (!state.local) throw new OctoError("remote_model", `${model} runs outside this computer`);
}

function timeoutError(signal: AbortSignal): OctoError {
  const reason = signal.reason;
  const error = asOllamaError(
    reason instanceof Error ? reason : new DOMException("timed out", "TimeoutError"),
  );
  return error instanceof OctoError
    ? error
    : new OctoError("ollama_timeout", "Ollama did not answer in time");
}

/** Streams the transcript; a timeout or a dropped connection while reading gets an Ollama code. */
async function readTranscript(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  let text = "";
  let aborted: string | null = null;
  try {
    for await (const line of ndjsonLines(body, signal)) {
      const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (chunk.error) {
        aborted = chunk.error;
        break;
      }
      text += chunk.message?.content ?? "";
    }
  } catch (error) {
    // Cancelling a stream that never closes rejects the read. Text already in hand is kept;
    // an empty read is the timeout, so a configured provider can try the screenshot once.
    const partial = cleanOcrText(text);
    if (partial.length > 0) return partial;
    if (signal.aborted) throw timeoutError(signal);
    throw asOllamaError(error);
  }
  // Ollama aborts dense, repetitive screens (tables) with "token repeat limit reached" after
  // reading them: keep what was streamed and fail only when nothing was read.
  const cleaned = cleanOcrText(text);
  if (cleaned.length === 0 && signal.aborted) throw timeoutError(signal);
  if (cleaned.length === 0 && aborted) throw new OctoError("ocr_failed", aborted);
  return cleaned;
}

const OCR_TIMEOUT_MS = 60_000;

export function createOllamaOcr(
  options: { base?: string; model?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): OcrReader {
  const base = options.base ?? DEFAULT_OLLAMA_BASE;
  if (!isLoopbackUrl(base)) {
    throw new OctoError("non_loopback_model", "screenshots are read only on this computer");
  }
  const model = options.model ?? DEFAULT_OCR_MODEL;
  let checked: Promise<void> | null = null;
  return {
    model,
    async read(imageBase64) {
      const fetchImpl = options.fetchImpl ?? fetch;
      try {
        checked ??= assertLocalModel(base, model, fetchImpl);
        await checked;
        const signal = AbortSignal.timeout(options.timeoutMs ?? OCR_TIMEOUT_MS);
        const response = await ollamaFetch(
          `${base}/api/chat`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model,
              stream: true,
              options: { num_ctx: 8_192, num_predict: 1_024, temperature: 0, stop: ["```"] },
              messages: [{ role: "user", content: OCR_PROMPT, images: [imageBase64] }],
            }),
            signal,
          },
          fetchImpl,
        );
        if (response.status === 404) {
          throw new OctoError("ocr_model_missing", `${model} is not installed`);
        }
        if (!response.ok || !response.body) {
          throw new OctoError("ocr_failed", `ollama ${response.status}`);
        }
        return await readTranscript(response.body, signal);
      } catch (error) {
        // Ollama may have been closed or the model removed: check again before the next frame.
        checked = null;
        throw error;
      }
    },
  };
}
