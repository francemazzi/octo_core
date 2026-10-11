import { describe, expect, it, vi } from "vitest";
import { createAnthropicAdapter, verifyAnthropicKey } from "./anthropic.js";

const evidence = [{ id: "ev-1", sourceId: "mon-1", startMs: 0, text: "synthetic order" }];
const KEY = "octo-anthropic-test-key";
const message = {
  model: "claude-test",
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        episodes: [{ episodeId: "order", activityType: "order_entry", evidenceIds: ["e1"] }],
      }),
    },
  ],
  usage: { input_tokens: 20, output_tokens: 10 },
};

describe("Anthropic adapter", () => {
  it("uses Messages API without tools and maps evidence aliases and usage", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(message));
    const adapter = createAnthropicAdapter({
      apiKey: KEY,
      fetchImpl,
      model: "claude-test",
      maxTokens: 500,
    });
    const reply = await adapter.interpret(evidence);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init?.headers).get("x-api-key")).toBe(KEY);
    expect(new Headers(init?.headers).get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "claude-test", max_tokens: 500 });
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("id=e1");
    expect(reply.raw).toMatchObject({ episodes: [{ evidenceIds: ["ev-1"] }] });
    expect(reply.usage).toEqual({ prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
  });
  it("checks the key without generation or evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    await verifyAnthropicKey({ apiKey: KEY, fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it.each([
    [401, "invalid_key"],
    [403, "invalid_key"],
    [404, "model_unavailable"],
    [429, "remote_unreachable"],
    [529, "remote_unreachable"],
    [400, "remote_rejected"],
  ])("classifies HTTP %s without disclosing response bodies", async (status, code) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: KEY }, { status: Number(status) }));
    await expect(
      createAnthropicAdapter({ apiKey: KEY, fetchImpl }).interpret(evidence),
    ).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["max_tokens", "refusal", "tool_use"])("rejects %s output", async (stop_reason) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...message, stop_reason }));
    await expect(
      createAnthropicAdapter({ apiKey: KEY, fetchImpl }).interpret(evidence),
    ).rejects.toMatchObject({ code: "invalid_model_output" });
  });
  it("sanitizes timeout and network failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException(KEY, "TimeoutError"));
    await expect(
      createAnthropicAdapter({ apiKey: KEY, fetchImpl }).interpret(evidence),
    ).rejects.toThrow("Anthropic could not be reached");
  });
  it("sends an explicit workspace on both key verification and analysis", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(message));
    const options = { apiKey: KEY, workspaceId: "wrkspc_test", fetchImpl };
    await verifyAnthropicKey(options);
    await createAnthropicAdapter(options).interpret(evidence);
    for (const [, init] of fetchImpl.mock.calls)
      expect(new Headers(init?.headers).get("anthropic-workspace-id")).toBe("wrkspc_test");
  });
  it("explains a missing workspace without exposing the provider error body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: `Missing anthropic-workspace-id ${KEY}` } },
          { status: 400 },
        ),
      );
    await expect(verifyAnthropicKey({ apiKey: KEY, fetchImpl })).rejects.toMatchObject({
      code: "workspace_required",
      message: "Anthropic requires a workspace ID for this key",
    });
  });
});
