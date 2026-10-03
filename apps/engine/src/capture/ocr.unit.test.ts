import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { cleanOcrText, createOllamaOcr } from "./ocr.js";

function stream(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => JSON.stringify(chunk)).join("\n"));
}

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
      base: "http://127.0.0.1:11434",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return stream([
          { message: { content: "Ordine " } },
          { message: { content: "Rossi\n```\nOrdine" } },
        ]);
      }) as typeof fetch,
    });
    await expect(ocr.read("aW1n")).resolves.toBe("Ordine Rossi");
    expect(urls).toEqual(["http://127.0.0.1:11434/api/chat"]);
    expect(bodies[0]).toMatchObject({
      model: "glm-ocr",
      options: { stop: ["```"], num_ctx: 8_192 },
      messages: [{ role: "user", content: "Text Recognition:", images: ["aW1n"] }],
    });
  });

  it("keeps the text read before Ollama aborts a repetitive screen", async () => {
    const aborted = { error: "prediction aborted, token repeat limit reached" };
    const partial = createOllamaOcr({
      base: "http://127.0.0.1:11434",
      fetchImpl: (async () =>
        stream([{ message: { content: "1001 Rossi\n1002 Bianchi" } }, aborted])) as typeof fetch,
    });
    await expect(partial.read("aW1n")).resolves.toBe("1001 Rossi\n1002 Bianchi");
    const empty = createOllamaOcr({
      base: "http://127.0.0.1:11434",
      fetchImpl: (async () => stream([aborted])) as typeof fetch,
    });
    await expect(empty.read("aW1n")).rejects.toMatchObject({ code: "ocr_failed" });
  });

  it("reads screenshots only on this computer", () => {
    expect(() => createOllamaOcr({ base: "http://192.168.1.20:11434" })).toThrow(OctoError);
  });
});
