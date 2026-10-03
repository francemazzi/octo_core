import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOllamaOcr } from "../../apps/engine/src/capture/ocr.js";

describe("live local OCR", () => {
  it("reads a synthetic order screen with the local vision model", async () => {
    const image = readFileSync(join(process.cwd(), "packages/test-fixtures/ocr-sample.jpg"));
    const ocr = createOllamaOcr({ model: process.env.OCTO_OCR_MODEL?.trim() || undefined });
    const text = await ocr.read(image.toString("base64"));
    expect(text).toContain("Rossi");
    expect(text).toContain("1234");
    expect(text).not.toContain("```");
  });
});
