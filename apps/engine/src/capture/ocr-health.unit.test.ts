import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { openDatabase } from "../storage/db.js";
import { createOcrMonitor } from "./ocr-health.js";

function monitor() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "octo-ocr-health-")), "octo.db"));
  const ocr = createOcrMonitor({
    db,
    nowWall: () => "2026-10-13T10:00:00.000Z",
    sessionId: () => null,
  });
  const audits = () =>
    (
      db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'ocr_failed'")
        .all() as Array<{
        detail_json: string;
      }>
    ).map((row) => JSON.parse(row.detail_json) as Record<string, string>);
  return { ocr, audits };
}

describe("OCR health", () => {
  it("counts failures in a row that mean the computer is not ready", () => {
    const { ocr, audits } = monitor();
    ocr.failed("f1", new OctoError("ollama_unreachable", "down"));
    ocr.failed("f2", new OctoError("ollama_unreachable", "down"));
    expect(ocr.health()).toEqual({ consecutiveFailures: 2, lastError: "ollama_unreachable" });
    ocr.failed("f3", new OctoError("ollama_timeout", "slow"));
    expect(ocr.health()).toEqual({ consecutiveFailures: 3, lastError: "ollama_timeout" });
    expect(audits().map((detail) => detail.error)).toEqual([
      "ollama_unreachable",
      "ollama_unreachable",
      "ollama_timeout",
    ]);
  });

  it("audits an unreadable screen without counting it, and a read resets the count", () => {
    const { ocr, audits } = monitor();
    ocr.failed("f1", new OctoError("ocr_model_missing", "glm-ocr is not installed"));
    ocr.failed("f2", new OctoError("ocr_failed", "token repeat limit reached"));
    ocr.failed("f3", new Error("disk"));
    expect(ocr.health()).toEqual({ consecutiveFailures: 1, lastError: "ocr_model_missing" });
    expect(audits().at(-1)).toEqual({ frameId: "f3", error: "internal", message: "disk" });
    ocr.reset();
    expect(ocr.health()).toEqual({ consecutiveFailures: 0, lastError: null });
  });
});
