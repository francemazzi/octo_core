import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEngine,
  createOpenRouterAdapter,
  dispatch,
  frameTimeline,
  modelWiring,
} from "@octo/engine";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const COST_CAP_USD = 0.01;
/** Two hours of screen text, three activities taking turns: two batches of evidence. */
const LONG_SESSION_FRAMES = 240;
const ACTIVITIES = [
  (n: number) =>
    `Gestionale ordini: cliente Rossi Srl, ordine ${4500 + n}, articolo 1234 qta ${(n % 9) + 1}, consegna 12/11`,
  (n: number) =>
    `Outlook posta: risposta a Bianchi SpA, conferma tempi di consegna lotto ${80 + n}, messaggio ${n}`,
  (n: number) =>
    `Excel listino 2026: ricerca codice articolo ${7700 + n}, prezzo unitario riga ${n}`,
];

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

  it.skipIf(apiKey === "")(
    "analyses a two-hour session in batches with the key set as in the app, under the cost cap",
    async () => {
      const env = { OPENROUTER_API_KEY: "", OPENROUTER_MODEL: process.env.OPENROUTER_MODEL };
      const engine = createEngine(
        mkdtempSync(join(tmpdir(), "octo-openrouter-long-")),
        modelWiring(env),
      );
      try {
        const configured = await dispatch(engine, {
          v: 1,
          id: "cfg",
          cmd: "model.configure",
          verify: true,
          remote: {
            provider: "openrouter",
            apiKey,
            ...(process.env.OPENROUTER_MODEL ? { model: process.env.OPENROUTER_MODEL.trim() } : {}),
          },
        });
        expect(configured).toMatchObject({
          remote: { provider: "openrouter", source: "settings" },
        });
        const { sessionId } = startDemo(engine);
        for (let index = 0; index < LONG_SESSION_FRAMES; index += 1) {
          const activity = ACTIVITIES[Math.floor(index / 20) % ACTIVITIES.length];
          engine.ingestFrame({
            frameId: `f-${index}`,
            sourceId: "mon-1",
            offsetMs: index * 30_000,
            payload: activity?.(index) ?? "",
          });
        }
        engine.setMono(10_000 + LONG_SESSION_FRAMES * 30_000);
        engine.stopSession();
        expect(engine.approveSession(sessionId)).toEqual({
          approved: LONG_SESSION_FRAMES,
          total: LONG_SESSION_FRAMES,
        });

        const result = await engine.runAnalysis("cloud_after_review", sessionId);
        const runs = engine.db
          .prepare("SELECT outcome, evidence_json, usage_json FROM analysis_runs ORDER BY rowid")
          .all() as Array<{ outcome: string; evidence_json: string; usage_json: string }>;
        const details = runs.map((run) => ({
          outcome: run.outcome,
          ...(JSON.parse(run.evidence_json) as {
            input: string[];
            evidenceSent: number;
            error?: string;
            message?: string;
          }),
          usage: JSON.parse(run.usage_json) as { completion_tokens?: number; cost?: number },
        }));
        const episodes = engine.db
          .prepare("SELECT label, duration_ms FROM episodes ORDER BY duration_ms DESC")
          .all();
        process.stdout.write(
          `OpenRouter long session: ${JSON.stringify({
            result,
            runs: details.map(({ outcome, input, error, usage, message }) => ({
              message,
              outcome,
              inputs: input.length,
              error,
              usage,
            })),
            episodes,
          })}\n`,
        );
        expect(result.reason).toBe("accepted");
        expect(result.partial).toBe(false);
        const accepted = details.filter((detail) => detail.outcome === "accepted");
        expect(accepted.map((detail) => detail.input.length)).toEqual([200, 40]);
        expect(accepted.every((detail) => detail.evidenceSent === LONG_SESSION_FRAMES)).toBe(true);
        expect(result.episodes).toBeGreaterThanOrEqual(2);
        const cost = details.reduce((sum, detail) => sum + (detail.usage.cost ?? 0), 0);
        expect(cost).toBeLessThan(COST_CAP_USD);
      } finally {
        engine.close();
      }
    },
  );
});
