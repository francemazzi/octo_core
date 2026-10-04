import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "../create-engine.js";

/** OCR whose reads finish only when the test says so, whichever comes first. */
function deferredOcr() {
  const waiting: Array<(text: string) => void> = [];
  const ready: string[] = [];
  return {
    reader: {
      model: "deferred",
      read: () => {
        const text = ready.shift();
        return text === undefined
          ? new Promise<string>((resolve) => waiting.push(resolve))
          : Promise.resolve(text);
      },
    },
    finish(text: string) {
      const resolve = waiting.shift();
      if (resolve) resolve(text);
      else ready.push(text);
    },
  };
}

describe("session duration", () => {
  it("is not shortened by frames that OCR stores after a pause or a stop", async () => {
    let mono = 1_000;
    const ocr = deferredOcr();
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-clock-")), {
      nowMono: () => mono,
      ocr: ocr.reader,
    });
    try {
      engine.startSession({
        projectId: "p",
        operatorPseudonym: "op",
        sourceIds: ["mon-1"],
        purpose: "clock",
      });
      engine.captureImage({ frameId: "a", sourceId: "mon-1", offsetMs: 5_000, imageBase64: "x" });
      mono = 9_000;
      engine.pauseSession();
      ocr.finish("ordine Rossi");
      await engine.drainCapture();
      expect(engine.durationMs()).toBe(8_000);

      mono = 9_500;
      engine.resumeSession();
      engine.captureImage({ frameId: "b", sourceId: "mon-1", offsetMs: 8_400, imageBase64: "y" });
      mono = 10_000;
      engine.stopSession();
      ocr.finish("posta fornitore");
      await engine.drainCapture();
      expect(engine.durationMs()).toBe(9_000);
      expect(engine.listEvidence()).toHaveLength(2);
    } finally {
      engine.close();
    }
  });
});
