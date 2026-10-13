import type { IngestResult } from "./ingest.js";
import type { OcrReader } from "./ocr.js";

export type ImageFrame = {
  frameId: string;
  sourceId: string;
  offsetMs: number;
  imageBase64: string;
};

export type TextFrame = { frameId: string; sourceId: string; offsetMs: number; payload: string };

/**
 * Screenshots waiting behind the one being read. A computer that reads slower than it captures
 * would queue screenshots without end and hold the analysis after Stop for as long: beyond this,
 * a new screenshot is skipped (less coverage, honest time) and the skip is audited.
 */
export const MAX_WAITING_IMAGES = 3;

export type ImageQueueDeps = {
  ocr: OcrReader | undefined;
  /** Binds the frame to the session as it is at receipt, so OCR finishing later still counts it. */
  accept: (sourceId: string) => ((text: TextFrame) => IngestResult) | { rejected: string };
  onFailure: (frameId: string, error: unknown) => void;
  /** A screenshot was read, even an empty one: OCR works again. */
  onRead?: () => void;
  /** A screenshot was skipped because `MAX_WAITING_IMAGES` were still waiting. */
  onSkipped?: (frameId: string, waiting: number) => void;
};

/**
 * Screenshots are read one at a time in the background, so the protocol loop stays free.
 * Stop, pause and analysis call `drain()` first: no frame lands after the session moved on.
 */
export function createImageQueue(deps: ImageQueueDeps) {
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    enqueue(frame: ImageFrame): { accepted: boolean; reason: string } {
      if (!deps.ocr) return { accepted: false, reason: "ocr_unavailable" };
      const ingest = deps.accept(frame.sourceId);
      if (typeof ingest !== "function") return { accepted: false, reason: ingest.rejected };
      // `pending` counts the screenshot being read too.
      if (pending > MAX_WAITING_IMAGES) {
        deps.onSkipped?.(frame.frameId, pending - 1);
        return { accepted: false, reason: "ocr_busy" };
      }
      const ocr = deps.ocr;
      pending += 1;
      chain = chain.then(async () => {
        try {
          const text = await ocr.read(frame.imageBase64);
          deps.onRead?.();
          if (text.length > 0) {
            ingest({
              frameId: frame.frameId,
              sourceId: frame.sourceId,
              offsetMs: frame.offsetMs,
              payload: text,
            });
          }
        } catch (error) {
          deps.onFailure(frame.frameId, error);
        } finally {
          pending -= 1;
        }
      });
      return { accepted: true, reason: "queued" };
    },
    drain(): Promise<void> {
      return chain;
    },
    pending(): number {
      return pending;
    },
  };
}
