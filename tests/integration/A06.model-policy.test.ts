import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptModelOutput, createEngine, dispatch, modelWiring, OctoError } from "@octo/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDemo } from "../helpers/engine.js";
import { fakeModelNetwork, promptAliases, type FakeModels } from "../helpers/model-network.js";

const KEY = "octo-test-key-abcd";
const LOCAL = "http://127.0.0.1:11434";
const FAKE_OPENROUTER = "http://127.0.0.1:4010/api/v1";
const INSTALLED = [
  { name: "gpt-oss:120b-cloud", remote_host: "https://ollama.com:443" },
  { name: "qwen2.5:7b-instruct-q4_K_M" },
  { name: "glm-ocr:latest" },
];

/** Every evidence of the prompt in one activity; later batches continue it as `a1`. */
function oneActivity(prompt: string): Record<string, unknown> {
  const continued = prompt.includes("episodeId=a1");
  return {
    title: "Ordini",
    episodes: [
      {
        episodeId: continued ? "a1" : "order",
        activityType: "order_entry",
        label: "Inserimento ordini",
        evidenceIds: promptAliases(prompt),
      },
    ],
    questions: [],
  };
}

/** The engine as the desktop starts it (`modelWiring(env)`), with the fake network behind fetch. */
function wiredEngine(env: NodeJS.ProcessEnv, models: FakeModels) {
  const network = fakeModelNetwork(models);
  vi.stubGlobal("fetch", network.fetch);
  const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a06-")), modelWiring(env));
  return { engine, network };
}

function recordFrames(engine: ReturnType<typeof createEngine>, texts: string[]): void {
  startDemo(engine);
  texts.forEach((payload, index) =>
    engine.ingestFrame({
      frameId: `f-${index}`,
      sourceId: "mon-1",
      offsetMs: index * 30_000,
      payload,
    }),
  );
  engine.setMono(10_000 + texts.length * 30_000);
  engine.stopSession();
}

function runs(engine: ReturnType<typeof createEngine>) {
  return engine.db
    .prepare("SELECT outcome, provider, data_mode, evidence_json FROM analysis_runs ORDER BY rowid")
    .all() as Array<{
    outcome: string;
    provider: string;
    data_mode: string;
    evidence_json: string;
  }>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("A06 model policy on the production wiring", () => {
  it.each(["openrouter", "anthropic"] as const)(
    "keeps local_only on this computer with %s and a cloud Ollama model",
    async (provider) => {
      const { engine, network } = wiredEngine(
        { OPENROUTER_API_KEY: KEY, ANTHROPIC_API_KEY: KEY, OCTO_REMOTE_PROVIDER: provider },
        { tags: INSTALLED, reply: oneActivity, ocrText: "ordine cliente Rossi" },
      );
      try {
        startDemo(engine);
        engine.captureImage({
          frameId: "img",
          sourceId: "mon-1",
          offsetMs: 0,
          imageBase64: "aW1n",
        });
        await engine.drainCapture();
        engine.ingestFrame({ frameId: "f", sourceId: "mon-1", offsetMs: 30_000, payload: "mail" });
        engine.setMono(10_000 + 60_000);
        engine.stopSession();
        const result = await engine.runAnalysis("local_only");

        expect(result).toMatchObject({ analysis: "completed", reason: "accepted", episodes: 1 });
        expect(network.calls.length).toBeGreaterThan(0);
        expect(network.calls.every((call) => call.url.startsWith(`${LOCAL}/`))).toBe(true);
        expect(network.calls.some((call) => call.authorization !== null)).toBe(false);
        const chats = network.calls.filter((call) => call.url.endsWith("/api/chat"));
        expect(chats.map((call) => (JSON.parse(call.body) as { model: string }).model)).toEqual([
          "glm-ocr",
          "qwen2.5:7b-instruct-q4_K_M",
        ]);
        expect(engine.networkAudits()).toHaveLength(0);
        expect(runs(engine).every((run) => run.data_mode === "local_only")).toBe(true);
      } finally {
        engine.close();
      }
    },
  );

  it("sends nothing when the only models run in the cloud or Ollama is on another host", async () => {
    const cloudOnly = wiredEngine(
      {},
      {
        tags: [
          { name: "gpt-oss:120b-cloud" },
          { name: "glm-ocr:latest", remote_host: "https://ollama.com:443" },
        ],
        reply: oneActivity,
      },
    );
    try {
      startDemo(cloudOnly.engine);
      cloudOnly.engine.captureImage({
        frameId: "img",
        sourceId: "mon-1",
        offsetMs: 0,
        imageBase64: "aW1n",
      });
      await cloudOnly.engine.drainCapture();
      cloudOnly.engine.ingestFrame({ frameId: "f", sourceId: "mon-1", offsetMs: 0, payload: "x" });
      cloudOnly.engine.setMono(10_000 + 30_000);
      cloudOnly.engine.stopSession();
      const result = await cloudOnly.engine.runAnalysis("local_only");
      expect(result.reason).toBe("model_unavailable");
      expect(cloudOnly.network.calls.some((call) => call.url.endsWith("/api/chat"))).toBe(false);
      const ocr = cloudOnly.engine.db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'ocr_failed'")
        .get() as { detail_json: string };
      expect(JSON.parse(ocr.detail_json)).toMatchObject({ error: "remote_model" });
    } finally {
      cloudOnly.engine.close();
    }

    const elsewhere = { OCTO_OLLAMA_URL: "http://10.0.0.5:11434" };
    expect(modelWiring(elsewhere).ocr).toBeUndefined();
    const remoteHost = wiredEngine(elsewhere, { tags: INSTALLED, reply: oneActivity });
    try {
      recordFrames(remoteHost.engine, ["ordine"]);
      const result = await remoteHost.engine.runAnalysis("local_only");
      expect(result.reason).toBe("model_unavailable");
      expect(remoteHost.network.calls).toEqual([]);
    } finally {
      remoteHost.engine.close();
    }
  });

  it("sends only approved evidence to the key set in the app, and never stores the key", async () => {
    const { engine, network } = wiredEngine(
      { OCTO_OPENROUTER_URL: FAKE_OPENROUTER },
      { tags: INSTALLED, reply: oneActivity },
    );
    try {
      const configured = await dispatch(engine, {
        v: 1,
        id: "cfg",
        cmd: "model.configure",
        verify: true,
        remote: { provider: "openrouter", apiKey: KEY },
      });
      expect(configured).toMatchObject({ remote: { provider: "openrouter", source: "settings" } });
      recordFrames(engine, ["ordine cliente Rossi approvato", "MARKER-NON-APPROVATO"]);
      engine.approveEvidence("ev-f-0");
      const result = await engine.runAnalysis("cloud_after_review");

      expect(result).toMatchObject({ reason: "accepted", episodes: 1 });
      const remote = network.calls.filter((call) => call.url.startsWith(FAKE_OPENROUTER));
      expect(remote.map((call) => call.url)).toEqual([
        `${FAKE_OPENROUTER}/key`,
        `${FAKE_OPENROUTER}/chat/completions`,
      ]);
      expect(remote.every((call) => call.authorization === `Bearer ${KEY}`)).toBe(true);
      const sent = remote[1]?.body ?? "";
      expect(sent).toContain("ordine cliente Rossi approvato");
      expect(sent).not.toContain("MARKER-NON-APPROVATO");
      const audits = engine.networkAudits() as Array<{ detail_json: string }>;
      expect(audits.map((audit) => JSON.parse(audit.detail_json))).toEqual([
        { evidenceIds: ["ev-f-0"], provider: "openrouter" },
      ]);
      const stored =
        JSON.stringify(engine.db.prepare("SELECT * FROM audit_events").all()) +
        JSON.stringify(engine.db.prepare("SELECT * FROM analysis_runs").all());
      expect(stored).not.toContain(KEY);
    } finally {
      engine.close();
    }
  });

  it("tries OpenRouter once more when it drops the connection", async () => {
    const { engine, network } = wiredEngine(
      { OPENROUTER_API_KEY: KEY, OCTO_OPENROUTER_URL: FAKE_OPENROUTER },
      {
        tags: INSTALLED,
        reply: (prompt, call) => {
          if (call === 1) throw new TypeError("terminated");
          return oneActivity(prompt);
        },
      },
    );
    try {
      recordFrames(engine, ["ordine cliente Rossi"]);
      engine.approveEvidence("ev-f-0");
      const result = await engine.runAnalysis("cloud_after_review");
      expect(result).toMatchObject({ reason: "accepted", episodes: 1 });
      expect(network.prompts).toHaveLength(2);
      expect(runs(engine).map((run) => run.outcome)).toEqual(["error", "accepted"]);
      expect(engine.networkAudits()).toHaveLength(2);
    } finally {
      engine.close();
    }
  });

  it("rejects a reply that invents evidence, after one more try", async () => {
    const { engine } = wiredEngine(
      {},
      {
        tags: INSTALLED,
        reply: () => ({
          episodes: [{ episodeId: "x", activityType: "order_entry", evidenceIds: ["e1", "e99"] }],
        }),
      },
    );
    try {
      recordFrames(engine, ["ordine", "mail"]);
      const result = await engine.runAnalysis("local_only");
      expect(result).toMatchObject({ reason: "unusable_output", episodes: 0 });
      const rejected = runs(engine).map(
        (run) => JSON.parse(run.evidence_json) as Record<string, unknown>,
      );
      expect(rejected).toHaveLength(2);
      for (const detail of rejected) {
        expect(detail).toMatchObject({
          error: "unknown_evidence",
          issues: { unknownEvidence: ["e99"] },
        });
      }
    } finally {
      engine.close();
    }
  });

  it.each(["ollama", "anthropic"] as const)(
    "analyses a long session with %s in batches that cover every evidence",
    async (provider) => {
      const { engine, network } = wiredEngine(
        provider === "anthropic" ? { ANTHROPIC_API_KEY: KEY } : {},
        { tags: INSTALLED, reply: oneActivity },
      );
      try {
        recordFrames(
          engine,
          Array.from({ length: 450 }, (_, index) => `riga ordine ${index}`),
        );
        if (provider === "anthropic") {
          for (let i = 0; i < 450; i++) engine.approveEvidence(`ev-f-${i}`);
        }
        const result = await engine.runAnalysis(
          provider === "anthropic" ? "cloud_after_review" : "local_only",
        );
        expect(result).toMatchObject({ reason: "accepted", episodes: 1 });
        expect(network.prompts).toHaveLength(3);
        expect(network.prompts[0]).not.toContain("episodeId=a1");
        expect(network.prompts[1]).toContain("episodeId=a1");
        const details = runs(engine).map(
          (run) => JSON.parse(run.evidence_json) as { input: string[]; evidenceSent: number },
        );
        expect(details.map((detail) => detail.input.length)).toEqual([200, 200, 50]);
        expect(new Set(details.flatMap((detail) => detail.input)).size).toBe(450);
        expect(details.every((detail) => detail.evidenceSent === 450)).toBe(true);
        const sessionId = (engine.db.prepare("SELECT id FROM sessions").get() as { id: string }).id;
        expect(engine.sessionDetail(sessionId).lastRun).toMatchObject({
          outcome: "accepted",
          provider,
          partial: false,
        });
      } finally {
        engine.close();
      }
    },
  );

  it("refuses output that cites unknown evidence, invents durations or changes policy", () => {
    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            { episodeId: "x", activityType: "a", evidenceIds: ["missing"], durationMs: 1 },
          ],
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            {
              episodeId: "x",
              activityType: "a",
              evidenceIds: ["ev-frame-a1"],
              durationMs: 9_999_999,
            },
          ],
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
    expect(() =>
      acceptModelOutput(
        {
          episodes: [
            { episodeId: "x", activityType: "a", evidenceIds: ["ev-frame-a1"], durationMs: 1 },
          ],
          policyOverride: "cloud_live_authorized",
        },
        new Set(["ev-frame-a1"]),
        2_460_000,
      ),
    ).toThrow(OctoError);
  });
  it("sends only approved evidence to Anthropic and retries without falling back to OpenRouter", async () => {
    const { engine, network } = wiredEngine(
      {
        OPENROUTER_API_KEY: KEY,
        ANTHROPIC_API_KEY: KEY,
        OCTO_REMOTE_PROVIDER: "anthropic",
        OCTO_ANTHROPIC_URL: "http://127.0.0.1:4011/v1",
      },
      {
        reply: (prompt, call) => {
          if (call === 1) throw new TypeError("connection lost");
          return oneActivity(prompt);
        },
      },
    );
    try {
      recordFrames(engine, ["APPROVED-TEXT", "PRIVATE-UNAPPROVED"]);
      engine.approveEvidence("ev-f-0");
      const result = await engine.runAnalysis("cloud_after_review");
      expect(result).toMatchObject({ reason: "accepted", episodes: 1 });
      expect(network.prompts).toHaveLength(2);
      expect(network.calls.every((call) => call.url.startsWith("http://127.0.0.1:4011/v1"))).toBe(
        true,
      );
      expect(network.calls.every((call) => call.authorization === KEY)).toBe(true);
      expect(network.calls[0]?.body).toContain("APPROVED-TEXT");
      expect(JSON.stringify(network.calls)).not.toContain("PRIVATE-UNAPPROVED");
      expect(runs(engine).map((run) => [run.provider, run.outcome])).toEqual([
        ["anthropic", "error"],
        ["anthropic", "accepted"],
      ]);
    } finally {
      engine.close();
    }
  });

  it("verifies a second provider without changing the active slot and clears only that provider", async () => {
    const { engine, network } = wiredEngine({ OPENROUTER_API_KEY: KEY }, {});
    try {
      await dispatch(engine, {
        v: 1,
        id: "verify",
        cmd: "model.configure",
        remote: { provider: "anthropic", apiKey: KEY },
        verify: true,
        verifyOnly: true,
      });
      expect((await engine.modelStatus()).remote?.provider).toBe("openrouter");
      expect(network.calls.map((call) => call.url)).toEqual([
        "https://api.anthropic.com/v1/models?limit=1",
        "http://127.0.0.1:11434/api/tags",
      ]);
      await dispatch(engine, {
        v: 1,
        id: "clear",
        cmd: "model.configure",
        remote: null,
        verify: false,
        environmentProvider: "anthropic",
      });
      expect((await engine.modelStatus()).remote).toBeNull();
    } finally {
      engine.close();
    }
  });

  it("pins the provider across batches even if engine configuration changes", async () => {
    let changed: Promise<unknown> | undefined;
    const { engine, network } = wiredEngine(
      { ANTHROPIC_API_KEY: KEY },
      {
        reply: (prompt, call) => {
          if (call === 1)
            changed = engine.configureRemoteModel({
              remote: { provider: "openrouter", apiKey: KEY },
              verify: false,
            });
          return oneActivity(prompt);
        },
      },
    );
    try {
      recordFrames(
        engine,
        Array.from({ length: 201 }, (_, i) => `synthetic order ${i}`),
      );
      for (let i = 0; i < 201; i++) engine.approveEvidence(`ev-f-${i}`);
      expect(await engine.runAnalysis("cloud_after_review")).toMatchObject({ reason: "accepted" });
      await changed;
      expect(network.calls.every((call) => call.url.endsWith("/messages"))).toBe(true);
      expect(runs(engine).map((run) => run.provider)).toEqual(["anthropic", "anthropic"]);
      expect((await engine.modelStatus()).remote?.provider).toBe("openrouter");
      const origins = engine.db.prepare("SELECT DISTINCT origin FROM episode_intervals").all();
      expect(origins).toEqual([{ origin: "anthropic" }]);
    } finally {
      engine.close();
    }
  });
});
