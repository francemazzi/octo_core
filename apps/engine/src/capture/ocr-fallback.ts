import { ocrBlockingErrorSchema, type RemoteProvider } from "@octo/contracts";
import { OctoError } from "../errors.js";
import { cleanOcrText, type OcrReader } from "./ocr.js";
import type { ScreenTranscriber } from "./remote-ocr.js";

/**
 * glm-ocr first. A blocking failure (too slow, Ollama down, model missing or not local) is read
 * once by the provider configured at that moment. Any other failure, or a remote failure, keeps
 * the local error so the pause thresholds stay the same. An unreadable screen is not sent.
 */
export function createFallbackOcr(deps: {
  local: OcrReader;
  current: () => ScreenTranscriber | undefined;
  /** Written before the image leaves: frame id and provider, nothing else. */
  audit: (frameId: string, provider: RemoteProvider) => void;
}): OcrReader {
  const reader: OcrReader = {
    model: deps.local.model,
    lastVia: null,
    async read(imageBase64, frameId = "") {
      try {
        const text = await deps.local.read(imageBase64);
        reader.lastVia = null;
        return text;
      } catch (error) {
        const remote = blocking(error) ? deps.current() : undefined;
        if (!remote) throw error;
        deps.audit(frameId, remote.provider);
        try {
          const text = cleanOcrText(await remote.transcribe(imageBase64));
          reader.lastVia = remote.provider;
          return text;
        } catch {
          throw error;
        }
      }
    },
  };
  return reader;
}

function blocking(error: unknown): boolean {
  return error instanceof OctoError && ocrBlockingErrorSchema.safeParse(error.code).success;
}
