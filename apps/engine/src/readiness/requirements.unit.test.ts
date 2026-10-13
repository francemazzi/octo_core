import { describe, expect, it } from "vitest";
import { missingRequirements, type ReadinessFacts } from "./requirements.js";

const READY: ReadinessFacts = {
  capture: "screen",
  keystore: true,
  ollama: { reachable: true },
  ocr: { model: "glm-ocr", installed: true, local: true },
  localModel: "qwen3.5:4b",
  remote: null,
};

describe("readiness requirements", () => {
  it("needs nothing more on a computer with Ollama, the OCR model and a model to analyse", () => {
    expect(missingRequirements(READY)).toEqual([]);
  });

  it("lists everything a fresh computer lacks, in the order the dashboard shows it", () => {
    expect(
      missingRequirements({
        ...READY,
        keystore: false,
        ollama: { reachable: false },
        ocr: { model: "glm-ocr", installed: false, local: false },
        localModel: null,
      }),
    ).toEqual(["keystore", "ollama", "ocr_model", "analysis_model"]);
  });

  it("refuses a cloud OCR model and a screen recording with OCR off", () => {
    const cloud = { ...READY, ocr: { model: "glm-ocr", installed: true, local: false } };
    expect(missingRequirements(cloud)).toEqual(["ocr_model"]);
    const off = { ...READY, ocr: { model: null, installed: false, local: false } };
    expect(missingRequirements(off)).toEqual(["ocr_model"]);
  });

  it("accepts a remote key instead of a local model", () => {
    const remote = { provider: "openrouter", model: "mistral" };
    expect(missingRequirements({ ...READY, localModel: null, remote })).toEqual([]);
  });

  it("asks only for a model when the capture is synthetic", () => {
    const synthetic: ReadinessFacts = {
      ...READY,
      capture: "synthetic",
      ollama: { reachable: false },
      ocr: { model: null, installed: false, local: false },
    };
    expect(missingRequirements(synthetic)).toEqual([]);
    expect(missingRequirements({ ...synthetic, localModel: null })).toEqual(["analysis_model"]);
  });
});
