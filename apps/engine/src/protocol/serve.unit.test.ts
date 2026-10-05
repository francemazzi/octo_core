import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameTimeline, type ModelAdapter } from "../analysis/model-adapter.js";
import { createEngine } from "../create-engine.js";
import { OctoError } from "../errors.js";
import { createProtocolHandler } from "./serve.js";

type Reply = {
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function waitingModel(gate: Promise<void>): ModelAdapter {
  return {
    provider: "stub",
    locality: "local",
    promptSchema: "stub@1",
    status: () => Promise.resolve({ up: true, model: "stub" }),
    async interpret(evidence) {
      await gate;
      const evidenceIds = evidence.map((item) => item.id);
      return {
        model: "stub",
        raw: { episodes: [{ episodeId: "w", activityType: "work", evidenceIds }] },
      };
    },
  };
}

describe("protocol handler", () => {
  it("answers pause and state while OCR and analysis are still running", async () => {
    let mono = 1_000;
    const ocrText = deferred<string>();
    const modelGate = deferred<void>();
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-serve-")), {
      nowMono: () => mono,
      ocr: { model: "deferred", read: () => ocrText.promise },
      analysis: {
        models: { local: waitingModel(modelGate.promise) },
        timeline: frameTimeline(60_000),
      },
    });
    const replies: Reply[] = [];
    const handler = createProtocolHandler(engine, (message) => replies.push(message as Reply));
    const send = (id: string, command: Record<string, unknown>) =>
      handler.handle(JSON.stringify({ v: 1, id, ...command }));
    const reply = (id: string) => replies.find((item) => item.id === id);
    const start = {
      cmd: "session.start",
      projectId: "p",
      operatorPseudonym: "op",
      sourceIds: ["mon-1"],
      purpose: "test",
    };
    try {
      await send("start", start);
      const first = reply("start")?.result?.sessionId as string;
      await send("img", {
        cmd: "capture.image",
        frameId: "a",
        sourceId: "mon-1",
        offsetMs: 0,
        imageBase64: "x",
      });
      mono = 31_000;
      await send("pause", { cmd: "session.pause" });
      expect(reply("pause")).toMatchObject({ ok: true, result: { capture: "paused" } });
      await send("stop", { cmd: "session.stop" });
      expect(reply("stop")?.ok).toBe(true);

      await send("analyse", { cmd: "analysis.run", mode: "local_only", sessionId: first });
      await send("state", { cmd: "session.state" });
      expect(reply("state")?.ok).toBe(true);
      expect(reply("analyse")).toBeUndefined();

      await send("start-2", start);
      expect(reply("start-2")?.result?.sessionId).not.toBe(first);
      ocrText.resolve("ordine cliente Rossi");
      modelGate.resolve();
      await handler.idle();
      expect(reply("analyse")).toMatchObject({ ok: true, result: { reason: "accepted" } });
      const analysed = engine.db.prepare("SELECT session_id FROM analysis_runs").all() as Array<{
        session_id: string;
      }>;
      expect(analysed).toEqual([{ session_id: first }]);
    } finally {
      engine.close();
    }
  });

  it("checks a key off the command line, never repeats it, and survives a null line", async () => {
    const KEY = "octo-test-key-abcd";
    const verification = deferred<void>();
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-serve-key-")), {
      remoteModels: {
        create: () => waitingModel(Promise.resolve()),
        verify: (config) =>
          config.apiKey === KEY
            ? verification.promise
            : Promise.reject(new OctoError("invalid_key", "OpenRouter refused the key")),
      },
    });
    const replies: Reply[] = [];
    const handler = createProtocolHandler(engine, (message) => replies.push(message as Reply));
    const send = (id: string, command: Record<string, unknown>) =>
      handler.handle(JSON.stringify({ v: 1, id, ...command }));
    const reply = (id: string) => replies.find((item) => item.id === id);
    const remote = (apiKey: string) => ({ provider: "openrouter", apiKey });
    try {
      await handler.handle("null");
      await send("bad", { cmd: "model.configure", verify: true, remote: remote(`${KEY}-zz`) });
      await send("save", { cmd: "model.configure", verify: true, remote: remote(KEY) });
      await send("state", { cmd: "session.state" });
      expect(reply("state")).toBeDefined();
      expect(reply("save")).toBeUndefined();
      verification.resolve();
      await new Promise((done) => setTimeout(done, 0));
      expect(reply("save")).toMatchObject({
        ok: true,
        result: { remote: { provider: "stub", source: "settings" } },
      });
      expect(reply("bad")).toMatchObject({ ok: false, error: { code: "invalid_key" } });
      await send("short", { cmd: "model.configure", verify: false, remote: remote("short") });
      expect(reply("short")).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
      expect(JSON.stringify(replies)).not.toContain(KEY);
      const audits = engine.db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'model_configured'")
        .all();
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain(KEY);
    } finally {
      engine.close();
    }
  });
});
