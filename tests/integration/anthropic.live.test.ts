import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, createAnthropicAdapter, frameTimeline } from "@octo/engine";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";

// Explicitly invoked B-track only. Never load keys from the repository or execute in gate:all.
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
if (!apiKey) process.stdout.write("LIVE_PENDING: ANTHROPIC_API_KEY is not set\n");
describe("live Anthropic (B06)", () => {
  it.skipIf(!apiKey)("analyses approved synthetic text", async () => {
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-anthropic-live-")), {
      analysis: {
        models: {
          remote: createAnthropicAdapter({
            apiKey,
            workspaceId: process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined,
            model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
            maxTokens: 800,
          }),
        },
        timeline: frameTimeline(60_000),
      },
    });
    try {
      startDemo(engine);
      engine.ingestFrame({
        frameId: "order",
        sourceId: "mon-1",
        offsetMs: 0,
        payload: "Synthetic ERP: enter order 123, item ABC, quantity 10, then save order.",
      });
      engine.approveEvidence("ev-order");
      engine.setMono(70_000);
      engine.stopSession();
      const result = await engine.runAnalysis("cloud_after_review");
      if (result.reason !== "accepted") {
        const failed = engine.db
          .prepare("SELECT evidence_json FROM analysis_runs ORDER BY rowid DESC LIMIT 1")
          .get();
        const detail = JSON.parse(String(failed?.evidence_json ?? "{}"));
        throw new Error(`Anthropic smoke failed: ${String(detail.error ?? result.reason)}`);
      }
      expect(result).toMatchObject({
        reason: "accepted",
        episodes: 1,
      });
      const row = engine.db
        .prepare(
          "SELECT provider, outcome, usage_json FROM analysis_runs WHERE outcome = 'accepted'",
        )
        .get();
      expect(row).toMatchObject({ provider: "anthropic", outcome: "accepted" });
      expect(JSON.parse(String(row?.usage_json)).total_tokens).toBeGreaterThan(0);
    } finally {
      engine.close();
    }
  });
});
