import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, createOpenRouterAdapter, frameTimeline } from "@octo/engine";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const COST_CAP_USD = 0.01;

if (apiKey === "") process.stdout.write("LIVE_PENDING: OPENROUTER_API_KEY is not set\n");

describe("live OpenRouter (B06)", () => {
  it.skipIf(apiKey === "")(
    "analyses only approved synthetic evidence in cloud_after_review, under the cost cap",
    async () => {
      const sentBodies: string[] = [];
      const recordingFetch: typeof fetch = (input, init) => {
        sentBodies.push(String(init?.body ?? ""));
        return fetch(input, init);
      };
      const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-openrouter-")), {
        analysis: {
          models: {
            remote: createOpenRouterAdapter({
              apiKey,
              model: process.env.OPENROUTER_MODEL?.trim() || undefined,
              maxTokens: 800,
              fetchImpl: recordingFetch,
            }),
          },
          timeline: frameTimeline(60_000),
        },
      });
      try {
        startDemo(engine);
        const frame = (frameId: string, offsetMs: number, payload: string) =>
          engine.ingestFrame({ frameId, sourceId: "mon-1", offsetMs, payload });
        frame("order", 0, "Gestionale: inserimento ordine cliente Rossi, articolo 1234, qta 10");
        frame("mail", 60_000, "Posta: risposta al fornitore Bianchi sui tempi di consegna");
        frame("private", 90_000, "Nota privata non approvata per il cloud");
        engine.approveEvidence("ev-order");
        engine.approveEvidence("ev-mail");
        engine.setMono(10_000 + 120_000);
        engine.stopSession();

        const result = await engine.runAnalysis("cloud_after_review");
        expect(result.reason).toBe("accepted");
        expect(result.episodes).toBeGreaterThan(0);

        expect(sentBodies).toHaveLength(1);
        expect(sentBodies[0]).toContain("id=e1");
        expect(sentBodies[0]).not.toContain("Nota privata");
        const audits = engine.networkAudits() as Array<{ detail_json: string }>;
        expect(JSON.parse(audits[0]?.detail_json ?? "{}")).toMatchObject({
          evidenceIds: ["ev-order", "ev-mail"],
          provider: "openrouter",
        });

        const run = engine.db
          .prepare("SELECT provider, outcome, usage_json, data_mode FROM analysis_runs")
          .get() as { provider: string; outcome: string; usage_json: string; data_mode: string };
        expect(run).toMatchObject({
          provider: "openrouter",
          outcome: "accepted",
          data_mode: "cloud_after_review",
        });
        const usage = JSON.parse(run.usage_json) as { total_tokens?: number; cost?: number };
        expect(usage.total_tokens ?? 0).toBeGreaterThan(0);
        expect(usage.cost ?? 0).toBeLessThan(COST_CAP_USD);
        process.stdout.write(`OpenRouter smoke: ${JSON.stringify(usage)}\n`);
      } finally {
        engine.close();
      }
    },
  );
});
