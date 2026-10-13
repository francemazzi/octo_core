import type { PullState } from "@octo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelPull } from "./pull.js";

const BASE = "http://127.0.0.1:11434";
const MODELS = { ocr: "glm-ocr", chat: "qwen3.5:4b" };

function lines(chunks: unknown[]): string {
  return chunks.map((chunk) => JSON.stringify(chunk)).join("\n");
}

/** Ollama answering `/api/pull` with `body`; `requests` collects what Octo asked for. */
function ollama(body: string | ReadableStream<Uint8Array>, requests: unknown[] = []): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(body);
  }) as typeof fetch;
}

async function settled(pull: { status(): PullState | null }): Promise<PullState | null> {
  await vi.waitFor(() => expect(pull.status()?.status).not.toBe("running"));
  return pull.status();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("model download", () => {
  it("downloads the model of the role, sums the layers and records start and end", async () => {
    const requests: unknown[] = [];
    const audit: unknown[] = [];
    const pull = createModelPull({
      base: BASE,
      models: MODELS,
      audit: (detail) => audit.push(detail),
      fetchImpl: ollama(
        lines([
          { status: "pulling manifest" },
          { status: "pulling a", digest: "sha256:a", total: 300, completed: 300 },
          { status: "pulling b", digest: "sha256:b", total: 100, completed: 50 },
          { status: "pulling b", digest: "sha256:b", total: 100, completed: 100 },
          { status: "verifying sha256 digest" },
          { status: "success" },
        ]),
        requests,
      ),
    });
    expect(pull.start("ocr")).toMatchObject({ role: "ocr", model: "glm-ocr", status: "running" });
    expect(await settled(pull)).toEqual({
      role: "ocr",
      model: "glm-ocr",
      status: "completed",
      completedBytes: 400,
      totalBytes: 400,
      error: null,
    });
    expect(requests).toEqual([{ model: "glm-ocr", stream: true }]);
    expect(audit).toEqual([
      { role: "ocr", model: "glm-ocr", outcome: "started" },
      { role: "ocr", model: "glm-ocr", outcome: "completed" },
    ]);
  });

  it("fails on an error line or a stream that ends before success", async () => {
    const broken = createModelPull({
      base: BASE,
      models: MODELS,
      audit: () => undefined,
      fetchImpl: ollama(lines([{ status: "pulling manifest" }, { error: "no space left" }])),
    });
    broken.start("chat");
    expect(await settled(broken)).toMatchObject({ status: "failed", error: "pull_failed" });

    const cut = createModelPull({
      base: BASE,
      models: MODELS,
      audit: () => undefined,
      fetchImpl: ollama(lines([{ status: "pulling manifest" }])),
    });
    cut.start("chat");
    expect(await settled(cut)).toMatchObject({ status: "failed", error: "pull_failed" });
  });

  it("runs one download at a time and names a stopped Ollama", async () => {
    const audit: unknown[] = [];
    const pull = createModelPull({
      base: BASE,
      models: MODELS,
      audit: (detail) => audit.push(detail),
      fetchImpl: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
    });
    pull.start("ocr");
    expect(() => pull.start("chat")).toThrow(expect.objectContaining({ code: "pull_busy" }));
    expect(await settled(pull)).toMatchObject({ status: "failed", error: "ollama_unreachable" });
    expect(audit.at(-1)).toEqual({
      role: "ocr",
      model: "glm-ocr",
      outcome: "failed",
      error: "ollama_unreachable",
    });
  });

  it("gives up when no progress arrives for too long", async () => {
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ status: "pulling" })}\n`));
      },
    });
    const pull = createModelPull({
      base: BASE,
      models: MODELS,
      audit: () => undefined,
      stallMs: 50,
      fetchImpl: (async () => new Response(silent)) as typeof fetch,
    });
    pull.start("ocr");
    expect(await settled(pull)).toMatchObject({ status: "failed", error: "pull_stalled" });
  });
});
