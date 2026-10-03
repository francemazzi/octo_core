import { describe, expect, it } from "vitest";
import { createOpenRouterAdapter, OPENROUTER_URL } from "./openrouter.js";

type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function stub(reply: unknown, captured: Captured[], status = 200): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json(reply, { status });
  }) as typeof fetch;
}

const evidence = [{ id: "ev-a", sourceId: "mon-1", startMs: 0, text: "ordine Rossi" }];

describe("OpenRouter adapter", () => {
  it("asks for JSON from providers that keep no data, and records usage", async () => {
    const captured: Captured[] = [];
    const adapter = createOpenRouterAdapter({
      apiKey: "test-key",
      model: "vendor/model",
      maxTokens: 500,
      fetchImpl: stub(
        {
          model: "vendor/model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  episodes: [
                    { episodeId: "o", activityType: "order_entry", evidenceIds: ["ev-a"] },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.0001 },
        },
        captured,
      ),
    });
    expect(adapter.locality).toBe("remote");
    const reply = await adapter.interpret(evidence);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(OPENROUTER_URL);
    expect(captured[0]?.headers.authorization).toBe("Bearer test-key");
    expect(captured[0]?.body).toMatchObject({
      model: "vendor/model",
      max_tokens: 500,
      response_format: { type: "json_object" },
      provider: { data_collection: "deny", zdr: true, require_parameters: true },
    });
    expect(JSON.stringify(captured[0]?.body.messages)).toContain("id=ev-a");
    expect(reply.raw).toMatchObject({
      episodes: [{ activityType: "order_entry", evidenceIds: ["ev-a"] }],
    });
    expect(reply.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      cost: 0.0001,
    });
  });

  it("is unavailable without a key and fails on an HTTP error", async () => {
    const captured: Captured[] = [];
    const noKey = createOpenRouterAdapter({ apiKey: "", fetchImpl: stub({}, captured) });
    await expect(noKey.status()).resolves.toMatchObject({ up: false });
    await expect(noKey.interpret(evidence)).rejects.toMatchObject({ code: "model_unavailable" });
    expect(captured).toHaveLength(0);

    const refused = createOpenRouterAdapter({
      apiKey: "test-key",
      fetchImpl: stub({ error: "no credits" }, captured, 402),
    });
    await expect(refused.interpret(evidence)).rejects.toThrow("openrouter 402");
  });
});
