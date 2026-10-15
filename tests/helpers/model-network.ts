/** One request the engine made, as the fake network saw it. */
export type NetworkCall = { url: string; body: string; authorization: string | null };

type ModelReply = Record<string, unknown>;

export type FakeModels = {
  /** Models listed by Ollama `/api/tags` (cloud ones carry `remote_host`). */
  tags?: Array<Record<string, unknown>>;
  /** Reply of a chat model to the user prompt; the same function serves Ollama and OpenRouter. */
  reply?: (prompt: string, call: number) => ModelReply;
  /** Text read by the OCR model from any screenshot. */
  ocrText?: string;
  /** HTTP status of OpenRouter `/key`. */
  keyStatus?: number;
};

/**
 * Fake Ollama and OpenRouter behind `fetch`: records every call and never touches the network.
 * Pass the result to `vi.stubGlobal("fetch", …)`.
 */
export function fakeModelNetwork(models: FakeModels = {}): {
  fetch: typeof fetch;
  calls: NetworkCall[];
  prompts: string[];
} {
  const calls: NetworkCall[] = [];
  const prompts: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      body,
      authorization: headers.get("authorization") ?? headers.get("x-api-key"),
    });
    if (url.endsWith("/api/tags")) return Response.json({ models: models.tags ?? [] });
    if (url.includes("/models?"))
      return Response.json({ data: [] }, { status: models.keyStatus ?? 200 });
    if (url.endsWith("/key")) {
      return Response.json({ data: { label: "test" } }, { status: models.keyStatus ?? 200 });
    }
    const parsed = JSON.parse(body) as {
      model?: string;
      messages?: Array<{ role: string; content?: unknown; images?: string[] }>;
    };
    const user = parsed.messages?.find((message) => message.role === "user");
    if (user?.images || hasImage(user?.content)) {
      const text = models.ocrText ?? "";
      if (url.endsWith("/messages")) {
        return Response.json({
          model: parsed.model,
          stop_reason: "end_turn",
          content: [{ type: "text", text }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      }
      if (url.endsWith("/api/chat")) {
        return new Response(JSON.stringify({ message: { content: text } }));
      }
      return Response.json({
        model: parsed.model,
        choices: [{ message: { content: text } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0 },
      });
    }
    const prompt = typeof user?.content === "string" ? user.content : "";
    prompts.push(prompt);
    const content = JSON.stringify(models.reply?.(prompt, prompts.length) ?? {});
    if (url.endsWith("/api/chat")) return Response.json({ message: { content } });
    if (url.endsWith("/messages"))
      return Response.json({
        model: parsed.model,
        stop_reason: "end_turn",
        content: [{ type: "text", text: content }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    return Response.json({
      model: parsed.model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.00001 },
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls, prompts };
}

function hasImage(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block.type === "image" || block.type === "image_url"),
    )
  );
}

/** The evidence aliases (`e1`, `e2`, …) of a prompt, in order. */
export function promptAliases(prompt: string): string[] {
  return [...prompt.matchAll(/^- id=(e\d+) /gm)].map((match) => match[1] ?? "");
}
