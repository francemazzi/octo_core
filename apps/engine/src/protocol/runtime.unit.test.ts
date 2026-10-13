import { describe, expect, it } from "vitest";
import { HostKeyProvider } from "../crypto/key-provider.js";
import {
  analysisProfile,
  ocrReader,
  ollamaWiring,
  openRouterBase,
  runtimeOptions,
} from "./runtime.js";

const KEY = { OPENROUTER_API_KEY: "octo-test-key-abcd" };

describe("engine runtime wiring", () => {
  it("puts local Ollama in the local slot and OpenRouter in the remote slot only with a key", () => {
    const plain = analysisProfile({});
    expect(plain.models.local).toMatchObject({ provider: "ollama", locality: "local" });
    expect(plain.models.remote).toBeUndefined();

    const withKey = analysisProfile(KEY);
    expect(withKey.models.local?.provider).toBe("ollama");
    expect(withKey.models.remote).toMatchObject({ provider: "openrouter", locality: "remote" });
  });

  it("leaves the local slot empty when the model is off or Ollama is on another host", () => {
    const off = analysisProfile({ ...KEY, OCTO_MODEL: "off" });
    expect(off.models.local).toBeUndefined();
    expect(off.models.remote?.provider).toBe("openrouter");

    const remoteHost = { OCTO_OLLAMA_URL: "http://10.0.0.5:11434" };
    expect(analysisProfile(remoteHost).models.local).toBeUndefined();
    expect(ocrReader(remoteHost)).toBeUndefined();
  });

  it("reads screenshots locally unless OCR is off", () => {
    expect(ocrReader({})?.model).toBe("glm-ocr");
    expect(ocrReader({ OCTO_OCR_MODEL: "custom-ocr" })?.model).toBe("custom-ocr");
    expect(ocrReader({ OCTO_OCR: "off" })).toBeUndefined();
  });

  it("replays the fixture only when asked", () => {
    const fixture = analysisProfile({ OCTO_MODEL: "fixture" });
    expect(fixture.models.local?.provider).toBe("fixture");
    expect(fixture.models.remote?.provider).toBe("fixture");
  });

  it("rejects an OpenRouter test URL off this computer and bad numbers", () => {
    expect(openRouterBase({})).toBeUndefined();
    expect(openRouterBase({ OCTO_OPENROUTER_URL: "http://127.0.0.1:4010/api/v1/" })).toBe(
      "http://127.0.0.1:4010/api/v1",
    );
    expect(() => analysisProfile({ ...KEY, OCTO_OPENROUTER_URL: "https://evil.example" })).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
    expect(() => analysisProfile({ OCTO_FRAME_SPAN_MS: "soon" })).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
  });
  it("selects explicit environment providers without a fallback to another key", () => {
    const env = { ...KEY, ANTHROPIC_API_KEY: "octo-anthropic-key-test" };
    expect(analysisProfile(env).models.remote?.provider).toBe("openrouter");
    expect(
      analysisProfile({ ...env, OCTO_REMOTE_PROVIDER: "anthropic" }).models.remote?.provider,
    ).toBe("anthropic");
    expect(
      analysisProfile({ ...KEY, OCTO_REMOTE_PROVIDER: "anthropic" }).models.remote,
    ).toBeUndefined();
    expect(
      analysisProfile({ ANTHROPIC_API_KEY: "octo-anthropic-key-test" }).models.remote?.provider,
    ).toBe("anthropic");
    expect(() => analysisProfile({ OCTO_ANTHROPIC_URL: "https://evil.example" })).toThrow();
    expect(() => analysisProfile({ ANTHROPIC_MAX_TOKENS: "0" })).toThrow();
    expect(() => analysisProfile({ OCTO_REMOTE_PROVIDER: "unknown" })).toThrow();
  });

  it("downloads the light chat model unless one is named, and only from this computer", () => {
    expect(ollamaWiring({})).toEqual({ base: "http://127.0.0.1:11434", chatModel: "qwen3.5:4b" });
    expect(ollamaWiring({ OCTO_OLLAMA_MODEL: "llama3.1:8b" })?.chatModel).toBe("llama3.1:8b");
    expect(ollamaWiring({ OCTO_OLLAMA_URL: "http://10.0.0.5:11434" })).toBeUndefined();
  });

  it("waits for the desktop's media key only when the desktop keeps it", () => {
    expect(runtimeOptions({}).keyProvider).toBeUndefined();
    const host = runtimeOptions({ OCTO_KEY_SOURCE: "host" }).keyProvider;
    expect(host).toBeInstanceOf(HostKeyProvider);
    expect(host?.available).toBe(false);
  });
});
