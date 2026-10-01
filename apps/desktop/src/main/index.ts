import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { app, BrowserWindow, ipcMain, nativeImage, type NativeImage } from "electron";
import { join } from "node:path";

declare const __dirname: string;

const here = __dirname;

type Capture = "idle" | "recording" | "paused" | "stopped";

type UiState = {
  capture: Capture;
  sources: Array<{ id: string; label: string; selected: boolean }>;
};

const ALLOWED = new Set(["octo:getState", "octo:start", "octo:pause", "octo:stop"]);

const state: UiState = {
  capture: "idle",
  sources: [
    { id: "mon-1", label: "Schermo 1", selected: false },
    { id: "mon-2", label: "Schermo 2", selected: false },
  ],
};

const dataDir = process.env.OCTO_DATA_DIR ?? join(app.getPath("userData"), "octo");

function startEngine(): ChildProcessWithoutNullStreams {
  const env = {
    ...process.env,
    OCTO_DATA_DIR: dataDir,
    OCTO_CAPTURE: process.env.OCTO_CAPTURE ?? "synthetic",
  };
  if (app.isPackaged) {
    return spawn(process.execPath, [join(process.resourcesPath, "engine.mjs")], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const repoRoot = process.env.OCTO_REPO_ROOT ?? join(here, "..", "..", "..");
  const engineEntry = process.env.OCTO_ENGINE_ENTRY ?? join(repoRoot, "apps/engine/src/main.ts");
  return spawn("pnpm", ["exec", "tsx", engineEntry], {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const child = startEngine();

const pending = new Map<
  string,
  (reply: { ok: boolean; result?: unknown; error?: { message: string } }) => void
>();
createInterface({ input: child.stdout }).on("line", (line) => {
  const reply = JSON.parse(line) as {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: { message: string };
  };
  pending.get(reply.id)?.(reply);
  pending.delete(reply.id);
});

function request(command: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown }> {
  const id = randomUUID();
  child.stdin.write(`${JSON.stringify({ v: 1, id, ...command })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("engine timeout")), 10_000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if (!reply.ok) reject(new Error(reply.error?.message ?? "engine error"));
      else resolve(reply);
    });
  });
}

function publish(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("octo:state", state);
  }
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
    height: view === "mascot" ? 260 : 520,
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
  void window.loadFile(join(here, "renderer", "index.html"), { query: { view } });
  return window;
}

async function stopIfNeeded(): Promise<void> {
  if (state.capture === "recording" || state.capture === "paused") {
    await request({ cmd: "session.stop" });
    state.capture = "stopped";
  }
}

app.setName("Octo Core");
if (process.platform === "win32") app.setAppUserModelId("it.octo.core");

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(logoImage());
  for (const channel of ALLOWED) {
    ipcMain.handle(channel, async (_event, payload: unknown) => {
      if (channel === "octo:getState") return state;
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
        await request({
          cmd: "capture.frame",
          frameId: "live-1",
          sourceId: sourceIds[0],
          offsetMs: 1_000,
          payload: "schermo",
        });
        state.capture = "recording";
        for (const source of state.sources) source.selected = sourceIds.includes(source.id);
        if (!mascot) mascot = createWindow("mascot");
        mascot.showInactive();
        publish();
        return state;
      }
      if (channel === "octo:pause") {
        await request({ cmd: "session.pause" });
        await request({
          cmd: "capture.frame",
          frameId: "after-pause",
          sourceId: "mon-1",
          offsetMs: 999_999,
          payload: "dopo-pausa",
        });
        state.capture = "paused";
        publish();
        return state;
      }
      await stopIfNeeded();
      publish();
      return state;
    });
  }

  createWindow("dashboard");
  void request({ cmd: "handshake", clientVersion: 1 });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void stopIfNeeded()
    .then(() => request({ cmd: "shutdown" }))
    .finally(() => app.exit(0));
});
