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
    calls.push({ url, body, authorization: headers.get("authorization") });
    if (url.endsWith("/api/tags")) return Response.json({ models: models.tags ?? [] });
    if (url.endsWith("/key")) {
      return Response.json({ data: { label: "test" } }, { status: models.keyStatus ?? 200 });
    }
    const parsed = JSON.parse(body) as {
      model?: string;
      messages?: Array<{ role: string; content: string; images?: string[] }>;
    };
    const user = parsed.messages?.find((message) => message.role === "user");
    if (user?.images) {
      return new Response(JSON.stringify({ message: { content: models.ocrText ?? "" } }));
    }
    prompts.push(user?.content ?? "");
    const content = JSON.stringify(models.reply?.(user?.content ?? "", prompts.length) ?? {});
    if (url.endsWith("/api/chat")) return Response.json({ message: { content } });
    return Response.json({
      model: parsed.model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.00001 },
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls, prompts };
}

/** The evidence aliases (`e1`, `e2`, …) of a prompt, in order. */
export function promptAliases(prompt: string): string[] {
  return [...prompt.matchAll(/^- id=(e\d+) /gm)].map((match) => match[1] ?? "");
}
