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

      // The session assistant over the same approved text: one Messages API call, JSON reply.
      const { message } = await engine.chatSend({
        sessionId: engine.listSessions()[0]?.sessionId ?? "",
        text: "Quale ordine è stato inserito e con quale articolo?",
        mode: "cloud_after_review",
      });
      expect(message).toMatchObject({ role: "assistant", promptSchema: "chat@1" });
      expect(message.text.length).toBeGreaterThan(0);
      const chat = engine.db
        .prepare(
          "SELECT outcome, usage_json, evidence_json FROM analysis_runs WHERE prompt_schema = 'chat@1'",
        )
        .get() as { outcome: string; usage_json: string; evidence_json: string };
      expect(chat.outcome).toBe("accepted");
      expect(JSON.parse(chat.usage_json).total_tokens).toBeGreaterThan(0);
      expect(JSON.parse(chat.evidence_json)).toMatchObject({ chat: true, input: ["ev-order"] });
      expect(engine.networkAudits()).toHaveLength(2);
      process.stdout.write(
        `LIVE_CHAT: verified=${String(message.verified)} citations=${JSON.stringify(message.citations)}\n`,
      );
    } finally {
      engine.close();
    }
  });
});
