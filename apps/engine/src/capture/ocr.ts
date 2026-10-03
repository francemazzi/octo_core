import { isLoopbackUrl, ollamaBase } from "../analysis/ollama.js";
import { OctoError } from "../errors.js";

export const DEFAULT_OCR_MODEL = "glm-ocr";
const MAX_OCR_CHARS = 4_000;

type FetchLike = typeof fetch;

/** Turns a screenshot into text on this computer; the image itself is never stored. */
export interface OcrReader {
  readonly model: string;
  read(imageBase64: string): Promise<string>;
}

/** glm-ocr repeats its transcript inside code fences: keep the first copy only. */
export function cleanOcrText(raw: string): string {
  const firstCopy = raw.split("```")[0] ?? "";
  return firstCopy
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_OCR_CHARS);
}

export function createOllamaOcr(
  options: { base?: string; model?: string; fetchImpl?: FetchLike } = {},
): OcrReader {
  const base = options.base ?? ollamaBase();
  if (!isLoopbackUrl(base)) {
    throw new OctoError("non_loopback_model", "screenshots are read only on this computer");
  }
  const model = options.model ?? DEFAULT_OCR_MODEL;
  return {
    model,
    async read(imageBase64) {
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          options: { num_ctx: 8_192, num_predict: 1_024, temperature: 0, stop: ["```"] },
          messages: [{ role: "user", content: "Text Recognition:", images: [imageBase64] }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok || !response.body) {
        throw new OctoError("ocr_failed", `ollama ${response.status}`);
      }
      // Ollama aborts dense, repetitive screens (tables) with "token repeat limit reached" after
      // reading them: keep what was streamed and fail only when nothing was read.
      let text = "";
      let aborted: string | null = null;
      for await (const line of ndjsonLines(response.body)) {
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (chunk.error) {
          aborted = chunk.error;
          break;
        }
        text += chunk.message?.content ?? "";
      }
      const cleaned = cleanOcrText(text);
      if (cleaned.length === 0 && aborted) throw new OctoError("ocr_failed", aborted);
      return cleaned;
    },
  };
}

async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.length > 0) yield line;
      end = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) yield buffer.trim();
}
