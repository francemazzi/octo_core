import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { cleanOcrText, createOllamaOcr } from "./ocr.js";

const BASE = "http://127.0.0.1:11434";

function stream(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => JSON.stringify(chunk)).join("\n"));
}

/** Ollama with `tags` installed; every chat call streams `chunks`. */
function ollama(tags: unknown[], chunks: unknown[], urls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/api/tags")) return Response.json({ models: tags });
    return stream(chunks);
  }) as typeof fetch;
}

const GLM = [{ name: "glm-ocr:latest" }];

describe("local OCR", () => {
  it("keeps the first transcript and squeezes whitespace", () => {
    expect(
      cleanOcrText("Cliente:   Rossi\n\n\n\nArticolo 1234\n```markdown\nCliente: Rossi\n```"),
    ).toBe("Cliente: Rossi\n\nArticolo 1234");
    expect(cleanOcrText("x".repeat(5_000))).toHaveLength(4_000);
  });

  it("sends the screenshot to the local vision model and stops at the first code fence", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    const ocr = createOllamaOcr({
      base: BASE,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        if (String(input).endsWith("/api/tags")) return Response.json({ models: GLM });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return stream([
          { message: { content: "Ordine " } },
          { message: { content: "Rossi\n```\nOrdine" } },
        ]);
      }) as typeof fetch,
    });
    await expect(ocr.read("aW1n")).resolves.toBe("Ordine Rossi");
    await expect(ocr.read("aW1n")).resolves.toBe("Ordine Rossi");
    expect(urls).toEqual([`${BASE}/api/tags`, `${BASE}/api/chat`, `${BASE}/api/chat`]);
    expect(bodies[0]).toMatchObject({
      model: "glm-ocr",
      options: { stop: ["```"], num_ctx: 8_192 },
      messages: [{ role: "user", content: "Text Recognition:", images: ["aW1n"] }],
    });
  });

  it("keeps the text read before Ollama aborts a repetitive screen", async () => {
    const aborted = { error: "prediction aborted, token repeat limit reached" };
    const partial = createOllamaOcr({
      base: BASE,
      fetchImpl: ollama(GLM, [{ message: { content: "1001 Rossi\n1002 Bianchi" } }, aborted]),
    });
    await expect(partial.read("aW1n")).resolves.toBe("1001 Rossi\n1002 Bianchi");
    const empty = createOllamaOcr({ base: BASE, fetchImpl: ollama(GLM, [aborted]) });
    await expect(empty.read("aW1n")).rejects.toMatchObject({ code: "ocr_failed" });
  });

  it("reads screenshots only on this computer", () => {
    expect(() => createOllamaOcr({ base: "http://192.168.1.20:11434" })).toThrow(OctoError);
  });

  it("never sends a screenshot to a cloud or missing OCR model, and checks again later", async () => {
    const urls: string[] = [];
    const cloud = createOllamaOcr({
      base: BASE,
      model: "qwen3-vl:235b-cloud",
      fetchImpl: ollama([{ name: "qwen3-vl:235b-cloud" }], [], urls),
    });
    await expect(cloud.read("aW1n")).rejects.toMatchObject({ code: "remote_model" });
    const tagged = createOllamaOcr({
      base: BASE,
      fetchImpl: ollama(
        [{ name: "glm-ocr:latest", remote_host: "https://ollama.com:443" }],
        [],
        urls,
      ),
    });
    await expect(tagged.read("aW1n")).rejects.toMatchObject({ code: "remote_model" });
    const missing = createOllamaOcr({ base: BASE, fetchImpl: ollama([], [], urls) });
    await expect(missing.read("aW1n")).rejects.toMatchObject({ code: "ocr_failed" });
    await expect(missing.read("aW1n")).rejects.toMatchObject({ code: "ocr_failed" });
    expect(urls.filter((url) => url.endsWith("/api/tags"))).toHaveLength(4);
    expect(urls.some((url) => url.endsWith("/api/chat"))).toBe(false);
  });
});
