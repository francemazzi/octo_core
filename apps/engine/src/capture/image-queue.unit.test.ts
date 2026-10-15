import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { openDatabase } from "../storage/db.js";
import { createImageQueue, type TextFrame } from "./image-queue.js";
import { createOcrMonitor } from "./ocr-health.js";

function queueWith(read: () => Promise<string>) {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "octo-image-queue-")), "octo.db"));
  const monitor = createOcrMonitor({
    db,
    nowWall: () => "2026-10-15T11:00:00.000Z",
    sessionId: () => null,
  });
  const ingested: TextFrame[] = [];
  const queue = createImageQueue({
    ocr: { model: "glm-ocr", read },
    accept: () => (frame) => {
      ingested.push(frame);
      return { stored: true, reason: "stored" };
    },
    onFailure: (frameId, error) => monitor.failed(frameId, error),
    onRead: (via) => monitor.reset(via),
  });
  return { monitor, ingested, queue };
}

describe("image queue", () => {
  it("does not store an empty transcript or clear earlier failures", async () => {
    const { monitor, ingested, queue } = queueWith(() => Promise.resolve(""));
    monitor.failed("earlier", new OctoError("ollama_timeout", "slow"));
    expect(
      queue.enqueue({ frameId: "f1", sourceId: "mon-1", offsetMs: 0, imageBase64: "aW1n" }),
    ).toEqual({ accepted: true, reason: "queued" });
    await queue.drain();
    expect(ingested).toEqual([]);
    expect(monitor.health()).toEqual({
      consecutiveFailures: 1,
      lastError: "ollama_timeout",
      fallback: null,
    });
  });
});
