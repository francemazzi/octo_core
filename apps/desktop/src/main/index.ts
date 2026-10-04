import { join } from "node:path";
import { app } from "electron";
import type { UiSource } from "../shared/ui-state.js";
import { createEngineClient } from "./engine-client.js";
import { registerIpc } from "./ipc.js";
import { parseId } from "./questions.js";
import { createScreenCapture, orderedDisplays, screenPermission } from "./screen-capture.js";
import { createSessionControl, type SessionControl } from "./session-control.js";
import { createWindows } from "./windows.js";

declare const __dirname: string;

const here = __dirname;
const dataDir = process.env.OCTO_DATA_DIR ?? join(app.getPath("userData"), "octo");
/** The engine authorizes two displays (`mon-1`, `mon-2`). */
const MAX_SOURCES = 2;

const { child, request } = createEngineClient(dataDir, here);
let control: SessionControl | undefined;
let quitting = false;

child.on("exit", () => {
  if (!quitting) app.exit(1);
});

function displaySources(): UiSource[] {
  return orderedDisplays()
    .slice(0, MAX_SOURCES)
    .map((_display, index) => ({ id: `mon-${index + 1}`, label: `Schermo ${index + 1}` }));
}

async function modelNote(): Promise<string> {
  if (process.env.OCTO_MODEL === "off") return "";
  const reply = await request({ cmd: "model.status" });
  const status = reply.result as { up?: boolean; model?: string | null };
  return status.up && status.model ? `Ollama acceso (${status.model}).` : "Ollama spento.";
}

app.setName("Octo Core");
if (process.platform === "win32") app.setAppUserModelId("it.octo.core");

// `screen` and the default session exist only once the app is ready.
app.whenReady().then(async () => {
  const windows = createWindows(here);
  const capture = createScreenCapture(
    request,
    Number(process.env.OCTO_CAPTURE_INTERVAL_MS ?? 30_000),
    (message) => control?.reportCaptureError(message),
  );
  const session = createSessionControl({
    request,
    capture,
    synthetic: (process.env.OCTO_CAPTURE ?? "screen") === "synthetic",
    analyse: process.env.OCTO_MODEL !== "off",
    sources: displaySources,
    screenAllowed: () => screenPermission() === "granted",
    publish: (state) => windows.broadcast(state),
  });
  control = session;
  if (process.platform === "darwin") app.dock?.setIcon(windows.logo());
  registerIpc({
    "octo:getState": () => session.state,
    "octo:start": (payload) => session.start(payload),
    "octo:pause": () => session.pause(),
    "octo:resume": () => session.resume(),
    "octo:stop": () => session.stop(),
    "octo:answer": (payload) => session.answer(payload),
    "octo:defer": (payload) => session.defer(payload),
    "octo:analyze": (payload) => session.analyze(payload),
    "octo:sessionDetail": (payload) => session.detail(payload),
    "octo:openMain": (payload) => {
      windows.showDashboard();
      session.focus(payload === null ? null : parseId(payload, "sessione"));
    },
    "octo:mascotPointer": (payload, event) =>
      windows.setMascotPointer(event.sender, payload === true),
  });

  const dashboard = windows.createDashboard();
  // While a session runs, closing the dashboard only hides it: the corner logo stays the control.
  dashboard.on("close", (event) => {
    if (quitting) return;
    if (session.state.capture !== "idle") {
      event.preventDefault();
      dashboard.hide();
      return;
    }
    app.quit();
  });
  dashboard.webContents.once("did-finish-load", () => windows.createMascot());
  app.on("activate", () => windows.showDashboard());

  await request({ cmd: "handshake", clientVersion: 1 });
  const note = await modelNote().catch(() => "Ollama spento.");
  await session.boot(note);
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (control?.quit() ?? Promise.resolve())
    .catch((error: unknown) => process.stderr.write(`stop on quit failed: ${String(error)}\n`))
    .then(() => request({ cmd: "shutdown" }))
    .finally(() => app.exit(0));
});
