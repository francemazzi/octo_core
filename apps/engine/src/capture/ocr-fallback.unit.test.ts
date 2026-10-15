import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { createFallbackOcr } from "./ocr-fallback.js";
import type { OcrReader } from "./ocr.js";
import type { ScreenTranscriber } from "./remote-ocr.js";

function local(read: OcrReader["read"]): OcrReader {
  return { model: "glm-ocr", read };
}

function remote(provider: ScreenTranscriber["provider"], text: string | Error): ScreenTranscriber {
  return {
    provider,
    transcribe: () => (text instanceof Error ? Promise.reject(text) : Promise.resolve(text)),
  };
}

describe("OCR fallback", () => {
  it("stays on this computer when glm-ocr reads the screenshot", async () => {
    const calls: string[] = [];
    const reader = createFallbackOcr({
      local: local(() => Promise.resolve("Ordine Rossi")),
      current: () => {
        calls.push("remote");
        return remote("openrouter", "cloud");
      },
      audit: () => calls.push("audit"),
    });
    await expect(reader.read("aW1n", "f1")).resolves.toBe("Ordine Rossi");
    expect(reader.lastVia).toBeNull();
    expect(calls).toEqual([]);
  });

  it("does not send an unreadable screen", async () => {
    const calls: string[] = [];
    const reader = createFallbackOcr({
      local: local(() => Promise.reject(new OctoError("ocr_failed", "empty"))),
      current: () => remote("anthropic", "cloud"),
      audit: () => calls.push("audit"),
    });
    await expect(reader.read("aW1n", "f1")).rejects.toMatchObject({ code: "ocr_failed" });
    expect(calls).toEqual([]);
  });

  it("asks the configured provider once after a blocking failure and keeps its text", async () => {
    const audits: Array<{ frameId: string; provider: string }> = [];
    let provider: ScreenTranscriber["provider"] = "openrouter";
    const seen: string[] = [];
    const reader = createFallbackOcr({
      local: local(() => Promise.reject(new OctoError("ollama_timeout", "slow"))),
      current: () =>
        remote(provider, provider === "openrouter" ? "Ordine Rossi\n```copia" : "altro"),
      audit: (frameId, next) => {
        seen.push(next);
        audits.push({ frameId, provider: next });
      },
    });
    await expect(reader.read("aW1n", "f1")).resolves.toBe("Ordine Rossi");
    expect(reader.lastVia).toBe("openrouter");
    expect(audits).toEqual([{ frameId: "f1", provider: "openrouter" }]);

    provider = "anthropic";
    await expect(reader.read("aW1n", "f2")).resolves.toBe("altro");
    expect(seen).toEqual(["openrouter", "anthropic"]);
    expect(audits).toHaveLength(2);
  });

  it("rethrows the local error when the provider fails or no key is set", async () => {
    const audits: string[] = [];
    const failing = createFallbackOcr({
      local: local(() => Promise.reject(new OctoError("ollama_unreachable", "down"))),
      current: () => remote("openrouter", new Error("secret-image")),
      audit: () => audits.push("audit"),
    });
    await expect(failing.read("aW1n", "f1")).rejects.toMatchObject({ code: "ollama_unreachable" });
    expect(failing.lastVia).toBeNull();
    expect(audits).toEqual(["audit"]);

    const missing = createFallbackOcr({
      local: local(() => Promise.reject(new OctoError("ocr_model_missing", "gone"))),
      current: () => undefined,
      audit: () => audits.push("again"),
    });
    await expect(missing.read("aW1n", "f2")).rejects.toMatchObject({ code: "ocr_model_missing" });
    expect(audits).toEqual(["audit"]);
  });
});
