import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { engineCommandSchema, type PullState, type Readiness } from "@octo/contracts";
import {
  createEngine,
  dispatch,
  InMemoryKeyProvider,
  modelWiring,
  OctoError,
  type Engine,
} from "@octo/engine";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineRequest } from "../../apps/desktop/src/main/engine-client.js";
import { createReadinessControl } from "../../apps/desktop/src/main/readiness.js";
import { createSessionControl } from "../../apps/desktop/src/main/session-control.js";
import { buildDesktop, launch } from "../helpers/desktop.js";
import { fakeOllama, type FakeOllama } from "../helpers/fake-ollama.js";
import { fakeOpenRouter } from "../helpers/fake-openrouter.js";
import { EngineProcess } from "../helpers/process.js";

/** No key from a developer's `.env` may make a remote model look configured. */
const NO_REMOTE = { OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OCTO_REMOTE_PROVIDER: "" };

const open: Array<{ close(): unknown }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

async function ollama(initial: Parameters<typeof fakeOllama>[0] = {}): Promise<FakeOllama> {
  const fake = await fakeOllama(initial);
  open.push(fake);
  return fake;
}

/** The engine as the desktop main sees it: protocol validation, then the dispatch. */
function engineRequest(engine: Engine): EngineRequest {
  return async (command) => {
    try {
      const parsed = engineCommandSchema.parse({ v: 1, id: "test", ...command });
      return { ok: true, result: await dispatch(engine, parsed) };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "engine error");
    }
  };
}

async function readiness(engine: Engine, capture: "screen" | "synthetic"): Promise<Readiness> {
  return engine.readinessStatus(capture);
}

async function settledPull(engine: Engine): Promise<PullState | null> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await readiness(engine, "screen");
    if (state.pull?.status !== "running") return state.pull;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("download never finished");
}

function audits(engine: Engine, action: string): Array<Record<string, unknown>> {
  return (
    engine.db
      .prepare("SELECT detail_json FROM audit_events WHERE action = ? ORDER BY rowid")
      .all(action) as Array<{ detail_json: string }>
  ).map((row) => JSON.parse(row.detail_json) as Record<string, unknown>);
}

describe("A14 ready before recording", () => {
  it("says what is missing and downloads the allowlisted models from the app", async () => {
    const fake = await ollama({ down: true });
    const env = { ...NO_REMOTE, OCTO_OLLAMA_URL: fake.url };
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a14-")), modelWiring(env));
    try {
      expect((await readiness(engine, "screen")).missing).toEqual([
        "ollama",
        "ocr_model",
        "analysis_model",
      ]);
      expect((await readiness(engine, "synthetic")).missing).toEqual(["analysis_model"]);

      fake.state.down = false;
      fake.state.tags = [{ name: "glm-ocr:latest", remote_host: "https://ollama.com:443" }];
      const cloud = await readiness(engine, "screen");
      expect(cloud.ocr).toEqual({ model: "glm-ocr", installed: true, local: false });
      expect(cloud.missing).toEqual(["ocr_model", "analysis_model"]);
      expect(cloud.pullable).toEqual(["ocr", "chat"]);
      fake.state.tags = [];

      const release = fake.hold();
      expect(engine.pullModel("ocr")).toMatchObject({ role: "ocr", model: "glm-ocr" });
      expect(() => engine.pullModel("chat")).toThrow(
        expect.objectContaining({ code: "pull_busy" }),
      );
      await expect
        .poll(async () => (await readiness(engine, "screen")).pull?.completedBytes)
        .toBe(500);
      release();
      expect(await settledPull(engine)).toMatchObject({
        status: "completed",
        completedBytes: 1_000,
      });
      engine.pullModel("chat");
      expect(await settledPull(engine)).toMatchObject({ status: "completed", model: "qwen3.5:4b" });
      const ready = await readiness(engine, "screen");
      expect(ready).toMatchObject({ missing: [], ready: true, localModel: "qwen3.5:4b" });

      const evil = engineCommandSchema.safeParse({ v: 1, id: "x", cmd: "model.pull", model: "x" });
      expect(evil.success).toBe(false);
      const smuggled = engineCommandSchema.parse({
        v: 1,
        id: "x",
        cmd: "model.pull",
        role: "ocr",
        model: "evil",
      });
      expect(smuggled).not.toHaveProperty("model");
      expect(fake.state.pulls).toEqual(["glm-ocr", "qwen3.5:4b"]);

      fake.state.failPull = true;
      engine.pullModel("ocr");
      expect(await settledPull(engine)).toMatchObject({ status: "failed", error: "pull_failed" });
      expect(audits(engine, "model_pull").map((detail) => detail.outcome)).toEqual([
        "started",
        "completed",
        "started",
        "completed",
        "started",
        "failed",
      ]);
      expect(audits(engine, "network")).toEqual([]);
    } finally {
      engine.close();
    }

    const remoteOnly = createEngine(
      mkdtempSync(join(tmpdir(), "octo-a14-remote-")),
      modelWiring({ ...env, OCTO_MODEL: "off", OPENROUTER_API_KEY: "octo-test-key-abcd" }),
    );
    try {
      fake.state.failPull = false;
      fake.state.tags = [{ name: "glm-ocr:latest" }];
      expect(await readiness(remoteOnly, "screen")).toMatchObject({
        localModel: null,
        remote: { provider: "openrouter" },
        pullable: ["ocr"],
        ready: true,
      });
    } finally {
      remoteOnly.close();
    }
  });

  it("pauses when reading stops working and resumes only once the computer is ready", async () => {
    const fake = await ollama({ tags: [{ name: "glm-ocr:latest" }] });
    const engine = createEngine(
      mkdtempSync(join(tmpdir(), "octo-a14-pause-")),
      modelWiring({ ...NO_REMOTE, OCTO_MODEL: "fixture", OCTO_OLLAMA_URL: fake.url }),
    );
    const request = engineRequest(engine);
    const control = createSessionControl({
      request,
      capture: { start: () => undefined, stop: async () => undefined },
      synthetic: false,
      readiness: createReadinessControl({
        request,
        capture: "screen",
        publish: (next) => {
          control.state.readiness = next;
        },
        openExternal: async () => undefined,
      }),
      sources: () => [{ id: "mon-1", label: "Schermo 1" }],
      screenAllowed: () => true,
      publish: () => undefined,
      attention: () => undefined,
    });
    let frame = 0;
    async function screenshot(): Promise<void> {
      frame += 1;
      const reply = await request({
        cmd: "capture.image",
        frameId: `scr-${frame}`,
        sourceId: "mon-1",
        offsetMs: frame * 30_000,
        imageBase64: "aW1n",
      });
      control.captureReply(reply.result);
      await engine.drainCapture();
    }
    const captureState = () =>
      (engine.db.prepare("SELECT capture_state FROM sessions").get() as { capture_state: string })
        .capture_state;
    try {
      await control.start(["mon-1"]);
      expect(control.state).toMatchObject({ capture: "recording", error: null });
      await screenshot();
      expect(engine.listEvidence()).toHaveLength(1);

      fake.state.down = true;
      await screenshot();
      await screenshot();
      expect(engine.ocrHealth()).toEqual({
        consecutiveFailures: 2,
        lastError: "ollama_unreachable",
        fallback: null,
      });
      expect(control.state.capture).toBe("recording");
      await screenshot();
      await expect.poll(() => control.state.capture).toBe("paused");
      expect(control.state.pauseCause).toBe("ollama");
      expect(captureState()).toBe("paused");
      // The screenshot that triggered the pause was taken while recording: it is read, and fails too.
      expect(audits(engine, "ocr_failed").map((detail) => detail.error)).toEqual([
        "ollama_unreachable",
        "ollama_unreachable",
        "ollama_unreachable",
      ]);

      await control.resume();
      expect(control.state.error).toContain("Ollama non risponde");
      expect(captureState()).toBe("paused");
      fake.state.down = false;
      await control.resume();
      expect(control.state).toMatchObject({ capture: "recording", pauseCause: null, error: null });
      expect(engine.ocrHealth()).toEqual({
        consecutiveFailures: 0,
        lastError: null,
        fallback: null,
      });
      await control.stop();
    } finally {
      engine.close();
    }
  });

  it("pauses a computer too slow to read after three timeouts in a row", async () => {
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a14-slow-")), {
      ocr: {
        model: "glm-ocr",
        read: () => Promise.reject(new OctoError("ollama_timeout", "Ollama did not answer")),
      },
    });
    try {
      engine.startSession({
        projectId: "p",
        operatorPseudonym: "op",
        sourceIds: ["mon-1"],
        purpose: "test",
      });
      const request = engineRequest(engine);
      const replies: unknown[] = [];
      for (const index of [1, 2, 3, 4]) {
        const reply = await request({
          cmd: "capture.image",
          frameId: `slow-${index}`,
          sourceId: "mon-1",
          offsetMs: index * 30_000,
          imageBase64: "aW1n",
        });
        replies.push(reply.result);
        await engine.drainCapture();
      }
      expect(replies.at(-2)).toMatchObject({ ocr: { consecutiveFailures: 2 } });
      expect(replies.at(-1)).toMatchObject({
        ocr: { consecutiveFailures: 3, lastError: "ollama_timeout" },
      });
    } finally {
      engine.close();
    }
  });

  it("reads a slow screenshot with the saved key and keeps recording", async () => {
    const daemon = await ollama({ tags: [{ name: "glm-ocr:latest" }] });
    const openrouter = await fakeOpenRouter();
    open.push(openrouter);
    const key = "octo-test-key-abcd";
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a14-fallback-")), {
      ...modelWiring({
        ...NO_REMOTE,
        OCTO_MODEL: "fixture",
        OCTO_OLLAMA_URL: daemon.url,
        OCTO_OPENROUTER_URL: openrouter.url,
      }),
      ocr: {
        model: "glm-ocr",
        read: () => Promise.reject(new OctoError("ollama_timeout", "Ollama did not answer")),
      },
    });
    const request = engineRequest(engine);
    const control = createSessionControl({
      request,
      capture: { start: () => undefined, stop: async () => undefined },
      synthetic: false,
      readiness: createReadinessControl({
        request,
        capture: "screen",
        publish: (next) => {
          control.state.readiness = next;
        },
        openExternal: async () => undefined,
      }),
      sources: () => [{ id: "mon-1", label: "Schermo 1" }],
      screenAllowed: () => true,
      publish: () => undefined,
      attention: () => undefined,
    });
    let frame = 0;
    async function screenshot(): Promise<void> {
      frame += 1;
      const reply = await request({
        cmd: "capture.image",
        frameId: `slow-${frame}`,
        sourceId: "mon-1",
        offsetMs: frame * 30_000,
        imageBase64: "aW1n",
      });
      control.captureReply(reply.result);
      await engine.drainCapture();
    }
    try {
      await control.start(["mon-1"]);
      expect(control.state).toMatchObject({ capture: "recording", error: null });
      await screenshot();
      expect(openrouter.received.some((call) => call.path.endsWith("/chat/completions"))).toBe(
        false,
      );
      expect(engine.ocrHealth()).toMatchObject({
        consecutiveFailures: 1,
        lastError: "ollama_timeout",
      });
      expect(engine.listEvidence()).toHaveLength(0);

      await engine.configureRemoteModel({
        remote: { provider: "openrouter", apiKey: key },
        verify: true,
      });
      await screenshot();
      await screenshot();
      await screenshot();
      expect(control.state).toMatchObject({ capture: "recording", pauseCause: null });
      expect(engine.ocrHealth()).toEqual({
        consecutiveFailures: 0,
        lastError: null,
        fallback: "openrouter",
      });
      const chats = openrouter.received.filter((call) => call.path.endsWith("/chat/completions"));
      expect(chats).toHaveLength(3);
      expect(JSON.parse(chats[0]?.body ?? "{}").provider).toEqual({
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      });
      expect(audits(engine, "network")).toEqual([
        { frameId: "slow-2", provider: "openrouter", purpose: "ocr" },
        { frameId: "slow-3", provider: "openrouter", purpose: "ocr" },
        { frameId: "slow-4", provider: "openrouter", purpose: "ocr" },
      ]);
      const stored = JSON.stringify(engine.db.prepare("SELECT * FROM audit_events").all());
      expect(stored).not.toContain(key);
      expect(stored).not.toContain("aW1n");
      const row = engine.listEvidence()[0] as { asset_id: string };
      expect(engine.media.readPlaintext(row.asset_id).toString("utf8")).toContain("Ordine 1001");
      await control.stop();
    } finally {
      engine.close();
    }
  });

  it("skips screenshots beyond three waiting for OCR instead of queueing them without end", async () => {
    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve("Ordine 1001");
    });
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a14-queue-")), {
      ocr: { model: "glm-ocr", read: () => gate },
    });
    try {
      engine.startSession({
        projectId: "p",
        operatorPseudonym: "op",
        sourceIds: ["mon-1"],
        purpose: "test",
      });
      const frame = (index: number) => ({
        frameId: `q-${index}`,
        sourceId: "mon-1",
        offsetMs: index * 30_000,
        imageBase64: "aW1n",
      });
      // One being read, three waiting: the fifth and sixth are skipped, not queued.
      const results = [1, 2, 3, 4, 5, 6].map((index) => engine.captureImage(frame(index)));
      expect(results.map((result) => result.reason)).toEqual([
        "queued",
        "queued",
        "queued",
        "queued",
        "ocr_busy",
        "ocr_busy",
      ]);
      expect(audits(engine, "ocr_skipped")).toEqual([
        { frameId: "q-5", waiting: 3 },
        { frameId: "q-6", waiting: 3 },
      ]);
      release();
      await engine.drainCapture();
      expect(engine.captureImage(frame(7)).reason).toBe("queued");
      await engine.drainCapture();
      expect(engine.listEvidence()).toHaveLength(1);
      expect(
        engine.listEvents().filter((event) => (event as { kind: string }).kind === "frame_repeat"),
      ).toHaveLength(4);
    } finally {
      engine.close();
    }
  });

  it("keeps the media key across restarts and never reveals it", async () => {
    const fake = await ollama();
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a14-key-"));
    const key = randomBytes(32);
    const env = {
      ...NO_REMOTE,
      OCTO_KEY_SOURCE: "host",
      OCTO_MODEL: "fixture",
      OCTO_OLLAMA_URL: fake.url,
    };
    const replies: unknown[] = [];
    async function run(commands: Array<Record<string, unknown>>) {
      const engine = new EngineProcess(dataDir, env);
      open.push(engine);
      const exited = new Promise((done) => engine.child.once("exit", done));
      const results = [];
      for (const command of commands) {
        const reply = await engine.request(command);
        replies.push(reply);
        results.push(reply);
      }
      // After `shutdown` the database is closed: the next process may open it.
      engine.child.stdin.end();
      await Promise.race([exited, new Promise((done) => setTimeout(done, 5_000))]);
      return results;
    }
    const start = {
      cmd: "session.start",
      projectId: "p",
      operatorPseudonym: "op",
      sourceIds: ["mon-1"],
      purpose: "test",
    };
    const unlock = { cmd: "keys.unlock", key: key.toString("base64") };
    const [locked, refused] = await run([
      { cmd: "readiness.status", capture: "synthetic" },
      start,
      { cmd: "shutdown" },
    ]);
    expect(locked?.result).toMatchObject({ missing: ["keystore"], ready: false });
    expect(refused?.error?.code).toBe("keystore_unavailable");

    const [, started] = await run([
      unlock,
      start,
      {
        cmd: "capture.frame",
        frameId: "f1",
        sourceId: "mon-1",
        offsetMs: 1_000,
        payload: "Ordine 1001",
      },
      { cmd: "session.stop" },
      { cmd: "shutdown" },
    ]);
    const sessionId = (started?.result as { sessionId: string }).sessionId;
    const [again] = await run([unlock, { cmd: "shutdown" }]);
    expect(again?.ok).toBe(true);

    const same = createEngine(dataDir, { keyProvider: new InMemoryKeyProvider(key) });
    const asset = (same.listAssets() as Array<{ id: string }>)[0];
    expect(same.media.readPlaintext(asset!.id).toString("utf8")).toContain("Ordine 1001");
    const auditText = JSON.stringify(same.db.prepare("SELECT * FROM audit_events").all());
    same.close();

    const other = createEngine(dataDir, { keyProvider: new InMemoryKeyProvider(randomBytes(32)) });
    try {
      const result = await other.runAnalysis("local_only", sessionId);
      expect(result.reason).toBe("unreadable_evidence");
      expect(other.sessionDetail(sessionId).lastRun).toMatchObject({
        outcome: "unavailable",
        error: "unreadable_evidence",
      });
    } finally {
      other.close();
    }
    expect(JSON.stringify(replies.slice(1))).not.toContain(key.toString("base64"));
    expect(auditText).not.toContain(key.toString("base64"));
  });

  it("guides the desktop from the list «Prima di registrare» to Avvia", async () => {
    buildDesktop();
    const fake = await ollama({ down: true });
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a14-desktop-"));
    const app = await launch(dataDir, {
      ...NO_REMOTE,
      OCTO_CAPTURE: "screen",
      OCTO_MODEL: "",
      OCTO_OLLAMA_URL: fake.url,
    });
    try {
      await app.evaluate(({ shell }) => {
        const opened: string[] = [];
        (globalThis as { opened?: string[] }).opened = opened;
        shell.openExternal = async (url: string) => {
          opened.push(url);
        };
      });
      const page = await app.firstWindow();
      const active = page.getByRole("region", { name: "Sessione attiva" });
      const list = active.getByRole("region", { name: "Prima di registrare" });
      await list.getByText("Ollama non risponde", { exact: false }).waitFor();
      await active.getByRole("checkbox", { name: "Schermo 1" }).check();
      const start = active.getByRole("button", { name: "Avvia", exact: true });
      expect(await start.isDisabled()).toBe(true);
      await list.getByRole("button", { name: "Installa Ollama" }).click();
      await expect
        .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
        .toEqual(["https://ollama.com/download"]);

      fake.state.down = false;
      await list.getByText("Ollama è attivo su questo computer.").waitFor();
      const release = fake.hold();
      await list.getByRole("button", { name: "Scarica modello di lettura" }).click();
      await list.getByRole("progressbar", { name: "Download di glm-ocr" }).waitFor();
      release();
      await list.getByText("Le schermate vengono lette su questo computer (glm-ocr).").waitFor();
      await list.getByRole("button", { name: "Scarica modello locale" }).click();
      await list.getByText("Il computer è pronto per registrare").waitFor();
      expect(await start.isEnabled()).toBe(true);

      const refused = await page.evaluate(async () => {
        try {
          await window.octo.pullModel("evil" as "ocr");
          return "accepted";
        } catch (error) {
          return String(error);
        }
      });
      expect(refused).toContain("Modello non valido.");
      expect(fake.state.pulls).toEqual(["glm-ocr", "qwen3.5:4b"]);
    } finally {
      await app.close();
    }
  }, 240_000);

  it("asks for the remote consent right after Stop when no local model exists", async () => {
    buildDesktop();
    const openrouter = await fakeOpenRouter();
    open.push(openrouter);
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a14-consent-"));
    const app = await launch(dataDir, {
      ...NO_REMOTE,
      OCTO_MODEL: "off",
      OPENROUTER_API_KEY: "octo-env-key-0000",
      OCTO_REMOTE_PROVIDER: "openrouter",
      OCTO_OPENROUTER_URL: openrouter.url,
    });
    try {
      const page = await app.firstWindow();
      const active = page.getByRole("region", { name: "Sessione attiva" });
      await active.getByRole("checkbox", { name: "Schermo 1" }).check();
      await active.getByRole("button", { name: "Avvia", exact: true }).click();
      await active.getByRole("button", { name: "Pausa", exact: true }).waitFor();
      // The synthetic frame is taken at 1 s: the session must last longer for it to count.
      await page.waitForTimeout(2_500);
      await active.getByRole("button", { name: "Stop", exact: true }).click();
      const detail = page.getByRole("article", { name: "Dettaglio sessione" });
      const confirm = detail.getByRole("region", { name: "Conferma invio a OpenRouter" });
      await confirm.getByText("testo letto da 1 schermata", { exact: false }).waitFor();
      expect(openrouter.received.some((call) => call.path.endsWith("/chat/completions"))).toBe(
        false,
      );
      await confirm.getByRole("button", { name: "Invia" }).click();
      await page.getByText("Attività riconosciute: 1.", { exact: false }).waitFor();
      const select = detail.getByRole("combobox", { name: "Modello dell'assistente" });
      expect(await select.locator("option").allTextContents()).toEqual(["OpenRouter"]);
    } finally {
      await app.close();
    }
    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const runs = db.prepare("SELECT data_mode FROM analysis_runs").all();
    const network = db
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'network'")
      .get();
    db.close();
    expect(runs).toEqual([{ data_mode: "cloud_after_review" }]);
    expect(network).toEqual({ count: 1 });
  }, 240_000);

  it("records only with a keystore, and then sessions stay readable after a restart", async () => {
    buildDesktop();
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a14-keystore-"));
    const env = { ...NO_REMOTE, OCTO_MEDIA_KEY: "" };
    let app = await launch(dataDir, env);
    try {
      const secure = await app.evaluate(
        ({ safeStorage }) =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text"),
      );
      let page = await app.firstWindow();
      let active = page.getByRole("region", { name: "Sessione attiva" });
      await active.getByRole("checkbox", { name: "Schermo 1" }).check();
      if (!secure) {
        await active.getByText("Archivio sicuro", { exact: true }).waitFor();
        expect(await active.getByRole("button", { name: "Avvia", exact: true }).isDisabled()).toBe(
          true,
        );
        expect(existsSync(join(dataDir, "media-key.bin"))).toBe(false);
        return;
      }
      await active.getByText("Il computer è pronto per registrare").waitFor();
      expect(existsSync(join(dataDir, "media-key.bin"))).toBe(true);
      await active.getByRole("button", { name: "Avvia", exact: true }).click();
      await active.getByRole("button", { name: "Stop", exact: true }).click();
      await active.getByText("Nessuna sessione attiva").waitFor();
      await app.close();

      app = await launch(dataDir, env);
      page = await app.firstWindow();
      active = page.getByRole("region", { name: "Sessione attiva" });
      await active.getByText("Il computer è pronto per registrare").waitFor();
      const assistant = page.getByRole("region", { name: "Assistente della sessione" });
      await assistant
        .getByRole("textbox", { name: "Domanda per l'assistente" })
        .fill("Cosa c'era sullo schermo?");
      await assistant.getByRole("button", { name: "Chiedi" }).click();
      await assistant.getByText("Schermata +00:01").waitFor({ timeout: 60_000 });
      expect(await assistant.getByText("Contesto parziale", { exact: false }).count()).toBe(0);
    } finally {
      await app.close();
    }
  }, 240_000);
});
