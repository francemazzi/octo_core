import { app, BrowserWindow, ipcMain, nativeImage, type NativeImage } from "electron";
import { join } from "node:path";
import { createEngineClient } from "./engine-client.js";
import { createScreenCapture, screenPermission } from "./screen-capture.js";
import {
  answerNote,
  fetchQuestions,
  parseAnswer,
  parseQuestionId,
  type UiQuestion,
} from "./questions.js";

declare const __dirname: string;

const here = __dirname;

type Capture = "idle" | "recording" | "paused" | "stopped";

type UiState = {
  capture: Capture;
  note: string;
  sources: Array<{ id: string; label: string; selected: boolean }>;
  questions: UiQuestion[];
};

const ALLOWED = new Set([
  "octo:getState",
  "octo:start",
  "octo:pause",
  "octo:stop",
  "octo:answer",
  "octo:defer",
]);

const state: UiState = {
  capture: "idle",
  note: "",
  questions: [],
  sources: [
    { id: "mon-1", label: "Schermo 1", selected: false },
    { id: "mon-2", label: "Schermo 2", selected: false },
  ],
};

const dataDir = process.env.OCTO_DATA_DIR ?? join(app.getPath("userData"), "octo");

const { child, request } = createEngineClient(dataDir, here);

/** `screen` captures the real displays; `synthetic` (tests) sends one fixed frame. */
const captureMode = process.env.OCTO_CAPTURE ?? "screen";
const capture = createScreenCapture(
  request,
  Number(process.env.OCTO_CAPTURE_INTERVAL_MS ?? 30_000),
  (message) => {
    state.note = screenPermission() === "granted" ? message : PERMISSION_NOTE;
    publish();
  },
);

const PERMISSION_NOTE =
  "Octo non vede lo schermo: concedi il permesso Registrazione schermo in Impostazioni di Sistema > Privacy e sicurezza, poi riavvia Octo.";

function publish(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("octo:state", state);
  }
}

async function refreshQuestions(): Promise<void> {
  state.questions = await fetchQuestions(request);
}

let mascot: BrowserWindow | undefined;
let quitting = false;
child.on("exit", () => {
  if (!quitting) app.exit(1);
});

function logoImage(): NativeImage {
  return nativeImage.createFromPath(join(here, "renderer", "logo_octo.png"));
}

function createWindow(view: "dashboard" | "mascot"): BrowserWindow {
  const window = new BrowserWindow({
    width: view === "mascot" ? 220 : 420,
    height: view === "mascot" ? 260 : 680,
    title: "Octo",
    icon: logoImage(),
    alwaysOnTop: view === "mascot",
    resizable: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        ],
      },
    });
  });
  // Octo's own windows stay out of the screenshots it takes.
  window.setContentProtection(true);
  void window.loadFile(join(here, "renderer", "index.html"), { query: { view } });
  return window;
}

async function stopIfNeeded(): Promise<void> {
  if (state.capture === "recording" || state.capture === "paused") {
    await capture.stop();
    await request({ cmd: "session.stop" }, 150_000);
    state.capture = "stopped";
  }
}

let finishing: Promise<void> | undefined;

function finishSession(): Promise<void> {
  finishing ??= finishSessionOnce().finally(() => {
    finishing = undefined;
  });
  return finishing;
}

async function finishSessionOnce(): Promise<void> {
  await stopIfNeeded();
  if (state.capture !== "stopped" || process.env.OCTO_MODEL === "off") return;
  try {
    const analysis = await request({ cmd: "analysis.run", mode: "local_only" }, 150_000);
    const report = await request({ cmd: "report.tick" }, 30_000);
    state.note = statusNote(analysis.result, report.result);
    await refreshQuestions();
  } catch {
    state.note = "Analisi non riuscita.";
  }
}

function statusNote(analysis: unknown, report: unknown): string {
  const extracted = analysis as {
    analysis?: string;
    episodes?: number;
    reason?: string | null;
    model?: string | null;
  };
  const written = report as { issued?: boolean; path?: string | null };
  const model = extracted.model
    ? `Ollama acceso (${extracted.model}).`
    : extracted.reason === "no_evidence"
      ? "Nessuna schermata letta."
      : "Ollama spento.";
  const episodes =
    extracted.reason === "accepted" || extracted.reason === "already_analyzed"
      ? `Episodi estratti: ${extracted.episodes ?? 0}.`
      : "Nessun episodio estratto.";
  const question = extracted.analysis === "awaiting_answer" ? " C'è una domanda per te." : "";
  const cadence =
    written.issued && written.path
      ? `Mini report: ${written.path}`
      : "Prossimo mini report tra 3 giorni.";
  return `${model} ${episodes}${question} ${cadence}`;
}

app.setName("Octo Core");
if (process.platform === "win32") app.setAppUserModelId("it.octo.core");

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(logoImage());
  for (const channel of ALLOWED) {
    ipcMain.handle(channel, async (_event, payload: unknown) => {
      if (channel === "octo:getState") return state;
      if (channel === "octo:answer") {
        const reply = await request({ cmd: "question.answer", ...parseAnswer(payload) }, 150_000);
        state.note = answerNote(reply.result);
        await refreshQuestions();
        publish();
        return state;
      }
      if (channel === "octo:defer") {
        await request({ cmd: "question.defer", questionId: parseQuestionId(payload) });
        await refreshQuestions();
        publish();
        return state;
      }
      if (channel === "octo:start") {
        const sourceIds = Array.isArray(payload)
          ? payload.filter((id): id is string => typeof id === "string")
          : [];
        if (sourceIds.length === 0) throw new Error("scegli uno schermo");
        await request({
          cmd: "session.start",
          projectId: "desktop",
          operatorPseudonym: "op-demo",
          sourceIds,
          purpose: "Sessione",
        });
        if (captureMode === "synthetic") {
          await request({
            cmd: "capture.frame",
            frameId: "live-1",
            sourceId: sourceIds[0],
            offsetMs: 1_000,
            payload: "schermo",
          });
        } else {
          capture.start(sourceIds);
          if (screenPermission() === "denied") state.note = PERMISSION_NOTE;
        }
        state.capture = "recording";
        for (const source of state.sources) source.selected = sourceIds.includes(source.id);
        if (!mascot) mascot = createWindow("mascot");
        mascot.showInactive();
        publish();
        return state;
      }
      if (channel === "octo:pause") {
        await capture.stop();
        await request({ cmd: "session.pause" }, 150_000);
        if (captureMode === "synthetic") {
          await request({
            cmd: "capture.frame",
            frameId: "after-pause",
            sourceId: "mon-1",
            offsetMs: 999_999,
            payload: "dopo-pausa",
          });
        }
        state.capture = "paused";
        publish();
        return state;
      }
      await finishSession();
      publish();
      return state;
    });
  }

  createWindow("dashboard");
  void request({ cmd: "handshake", clientVersion: 1 })
    .then(() => refreshQuestions())
    .then(() => request({ cmd: "model.status" }))
    .then((reply) => {
      if (process.env.OCTO_MODEL !== "off") {
        const status = reply.result as { up?: boolean; model?: string | null };
        state.note =
          status.up && status.model ? `Ollama acceso (${status.model}).` : "Ollama spento.";
      }
      publish();
    })
    .catch(() => undefined);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void finishSession()
    .then(() => request({ cmd: "shutdown" }))
    .finally(() => app.exit(0));
});
