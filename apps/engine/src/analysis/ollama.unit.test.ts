import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { createOllamaAdapter, ollamaProfile, probeOllama } from "./ollama.js";

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
    const previous = process.env.OCTO_OLLAMA_MODEL;
    delete process.env.OCTO_OLLAMA_MODEL;
    try {
      await expect(probeOllama(fetchImpl, BASE)).resolves.toEqual({
        up: true,
        model: "qwen2.5:7b-instruct-q4_K_M",
      });
    } finally {
      if (previous === undefined) delete process.env.OCTO_OLLAMA_MODEL;
      else process.env.OCTO_OLLAMA_MODEL = previous;
    }
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
