import { join } from "node:path";
import type { CaptureMode } from "@octo/contracts";
import { app, shell } from "electron";
import type { UiSource } from "../shared/ui-state.js";
import { createChatControl } from "./chat.js";
import { createEngineClient, memoryMediaKey } from "./engine-client.js";
import { registerIpc } from "./ipc.js";
import { unlockMediaKey } from "./media-key.js";
import { parseId } from "./questions.js";
import { createReadinessControl } from "./readiness.js";
import { createRemoteModel } from "./remote-model.js";
import { createScreenCapture, orderedDisplays, screenPermission } from "./screen-capture.js";
import { keystoreBox } from "./secret-box.js";
import { createSessionControl, type SessionControl } from "./session-control.js";
import { createSettingsStore } from "./settings-store.js";
import { createUpdater } from "./updater.js";
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

/** Real screenshots need OCR on this computer; the synthetic frames of tests do not. */
const captureMode: CaptureMode =
  (process.env.OCTO_CAPTURE ?? "screen") === "synthetic" ? "synthetic" : "screen";

app.setName("Octo Core");
if (process.platform === "win32") app.setAppUserModelId("it.octo.core");

// `screen` and the default session exist only once the app is ready.
app.whenReady().then(async () => {
  const windows = createWindows(here);
  const capture = createScreenCapture(
    request,
    Number(process.env.OCTO_CAPTURE_INTERVAL_MS ?? 30_000),
    {
      onError: (message) => control?.reportCaptureError(message),
      onReply: (result) => control?.captureReply(result),
    },
  );
  const readiness = createReadinessControl({
    request,
    capture: captureMode,
    publish: (next) => {
      session.state.readiness = next;
      session.publish();
    },
    openExternal: (url) => shell.openExternal(url),
  });
  const session = createSessionControl({
    request,
    capture,
    synthetic: captureMode === "synthetic",
    readiness,
    sources: displaySources,
    screenAllowed: () => screenPermission() === "granted",
    publish: (state) => windows.broadcast(state),
    attention: () => windows.showDashboard(),
  });
  control = session;
  const remote = createRemoteModel({
    request,
    analyzing: () => session.state.analyzingSessionId !== null,
    store: createSettingsStore(join(dataDir, "settings.json"), keystoreBox()),
    publish: (state) => {
      session.state.remote = state;
      session.publish();
      // A saved key may be the model that was missing: Avvia must not wait for the next poll.
      readiness.refresh().catch((error: unknown) => {
        process.stderr.write(`readiness check failed: ${String(error)}\n`);
      });
    },
  });
  const updater = createUpdater({
    publish: (update) => {
      session.state.update = update;
      session.publish();
    },
  });
  const chat = createChatControl({
    request,
    state: () => session.state,
    remoteBusy: () => remote.busy(),
  });
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
    "octo:saveRemote": (payload) => remote.save(payload),
    "octo:removeRemote": (payload) => remote.remove(payload),
    "octo:selectRemote": (payload) => remote.select(payload),
    "octo:analyzeRemote": (payload) => {
      if (remote.busy()) throw new Error("Attendi il salvataggio delle impostazioni.");
      return session.analyzeRemote(payload);
    },
    "octo:installUpdate": () => updater.install(),
    "octo:chatSend": (payload) => chat.send(payload),
    "octo:chatHistory": (payload) => chat.history(payload),
    "octo:pullModel": async (payload) => {
      await readiness.pull(payload);
      return session.state;
    },
    "octo:installOllama": () => readiness.installOllama(),
    "octo:checkReadiness": async () => {
      await readiness.refresh();
      return session.state;
    },
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
  const keyNote = memoryMediaKey()
    ? null
    : await unlockMediaKey(request, join(dataDir, "media-key.bin"), keystoreBox()).catch(
        (error: unknown) => {
          process.stderr.write(`media key not unlocked: ${String(error)}\n`);
          return null;
        },
      );
  await remote
    .boot()
    .catch((error: unknown) => process.stderr.write(`remote model not set: ${String(error)}\n`));
  await session.boot(keyNote ?? "");
  readiness.start();
  // Only an installed app looks for updates; `pnpm start` runs the version of the checkout.
  if (app.isPackaged) void updater.check();
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
