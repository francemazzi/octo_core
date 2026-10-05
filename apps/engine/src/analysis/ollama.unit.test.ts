import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import {
  chooseChatModel,
  createOllamaAdapter,
  isRemoteOllamaModel,
  ollamaProfile,
  probeOllama,
  type OllamaTag,
} from "./ollama.js";

const BASE = "http://127.0.0.1:11434";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ollamaStub(reply: unknown, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/tags")) {
      return json({ models: [{ name: "qwen2.5:7b-instruct-q4_K_M" }] });
    }
    return json({ message: { content: JSON.stringify(reply) } });
  }) as typeof fetch;
}

describe("local Ollama boundary", () => {
  it("prefers a small instruct model and ignores embeddings", async () => {
    const fetchImpl = (async () =>
      json({
        models: [
          { name: "qwen38-27b-dsh:latest", capabilities: ["completion"] },
          { name: "bge-m3:latest", capabilities: ["embedding"] },
          { name: "qwen2.5:7b-instruct-q4_K_M", capabilities: ["completion"] },
        ],
      })) as typeof fetch;
    await expect(probeOllama(fetchImpl, BASE)).resolves.toEqual({
      up: true,
      model: "qwen2.5:7b-instruct-q4_K_M",
    });
  });

  it("never picks a cloud model, even when it is requested or the only one", () => {
    const tags: OllamaTag[] = [
      { name: "gpt-oss:120b-cloud" },
      { name: "glm-4.6:cloud" },
      { name: "kimi-k2:1t", remote_host: "https://ollama.com:443", remote_model: "kimi-k2:1t" },
      { name: "llama3.1:8b" },
    ];
    expect(isRemoteOllamaModel({ name: "gpt-oss:120b-cloud" })).toBe(true);
    expect(isRemoteOllamaModel({ name: "glm-4.6:cloud" })).toBe(true);
    expect(isRemoteOllamaModel({ name: "llama3.1:8b" })).toBe(false);
    expect(chooseChatModel(tags, { requested: "gpt-oss:120b-cloud" })).toBe("llama3.1:8b");
    expect(chooseChatModel(tags.slice(0, 3))).toBeNull();
  });

  it("skips models that read images, the OCR model and excluded names", () => {
    const tags: OllamaTag[] = [
      { name: "glm-ocr:latest" },
      { name: "llava:latest" },
      { name: "custom-vision:7b" },
      { name: "deepseek-coder:6.7b" },
    ];
    expect(chooseChatModel(tags, { exclude: ["custom-vision:7b"] })).toBe("deepseek-coder:6.7b");
    expect(chooseChatModel(tags.slice(0, 2))).toBeNull();
  });

  it("uses the requested local model and refuses to analyse with cloud models only", async () => {
    const calls: string[] = [];
    const tagsOnly = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return json({ models: [{ name: "gpt-oss:120b-cloud" }, { name: "qwen3:8b" }] });
    }) as typeof fetch;
    await expect(probeOllama(tagsOnly, BASE, { requested: "qwen3:8b" })).resolves.toEqual({
      up: true,
      model: "qwen3:8b",
    });
    const cloudOnly = createOllamaAdapter({
      base: BASE,
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return json({ models: [{ name: "gpt-oss:120b-cloud" }] });
      }) as typeof fetch,
    });
    await expect(
      cloudOnly.interpret([{ id: "ev-a", sourceId: "mon-1", startMs: 0, text: "x" }]),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(calls.some((url) => url.endsWith("/api/chat"))).toBe(false);
  });

  it("reports Ollama down when the probe fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(probeOllama(fetchImpl, BASE)).resolves.toEqual({ up: false, model: null });
  });

  it("sends evidence to Ollama and returns a normalized reply", async () => {
    const calls: string[] = [];
    const adapter = createOllamaAdapter({
      base: BASE,
      fetchImpl: ollamaStub(
        { episodes: [{ episodeId: "ep", activityType: "mail", evidenceIds: ["e1"] }] },
        calls,
      ),
    });
    const reply = await adapter.interpret([
      { id: "ev-a", sourceId: "mon-1", startMs: 0, text: "posta" },
    ]);
    expect(reply.model).toBe("qwen2.5:7b-instruct-q4_K_M");
    expect(reply.raw).toMatchObject({
      episodes: [{ activityType: "mail", evidenceIds: ["ev-a"] }],
    });
    expect(calls.filter((url) => url.endsWith("/api/chat"))).toHaveLength(1);
  });

  it("reports an unreachable Ollama as model_unavailable", async () => {
    const adapter = createOllamaAdapter({
      base: BASE,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    await expect(adapter.interpret([])).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("never sends local_only evidence to a host that is not this computer", () => {
    expect(() => createOllamaAdapter({ base: "http://10.0.0.5:11434" })).toThrow(OctoError);
    expect(ollamaProfile({ base: "http://ollama.example.com:11434" }).models.local).toBeUndefined();
    expect(ollamaProfile({ base: "http://localhost:11434" }).models.local?.locality).toBe("local");
  });
});
