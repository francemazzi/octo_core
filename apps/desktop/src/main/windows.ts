import { join } from "node:path";
import {
  app,
  BrowserWindow,
  nativeImage,
  screen,
  session,
  type NativeImage,
  type WebContents,
} from "electron";
import type { UiState } from "../shared/ui-state.js";
import { mascotBounds } from "./mascot-layout.js";

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

/**
 * The dashboard (sessions by day) and the corner mascot. The mascot is a transparent, frameless,
 * always-on-top panel: clicks pass through it except while the pointer is on the logo.
 */
export function createWindows(here: string) {
  let dashboard: BrowserWindow | undefined;
  let mascot: BrowserWindow | undefined;
  const ignoreMouse = process.platform !== "linux";
  const webPreferences = {
    preload: join(here, "preload.cjs"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] } });
  });

  function load(window: BrowserWindow, view: "dashboard" | "mascot"): void {
    // Octo's own windows stay out of the screenshots it takes.
    window.setContentProtection(true);
    void window.loadFile(join(here, "renderer", "index.html"), { query: { view } });
  }

  function placeMascot(): void {
    if (!mascot || mascot.isDestroyed()) return;
    mascot.setBounds(mascotBounds(screen.getPrimaryDisplay().workArea));
    if (ignoreMouse) mascot.setIgnoreMouseEvents(true, { forward: true });
  }

  return {
    logo(): NativeImage {
      return nativeImage.createFromPath(join(here, "renderer", "logo_octo.png"));
    },
    createDashboard(): BrowserWindow {
      dashboard = new BrowserWindow({
        width: 960,
        height: 640,
        minWidth: 760,
        minHeight: 520,
        title: "Octo",
        icon: this.logo(),
        webPreferences,
      });
      load(dashboard, "dashboard");
      return dashboard;
    },
    createMascot(): BrowserWindow {
      mascot = new BrowserWindow({
        ...mascotBounds(screen.getPrimaryDisplay().workArea),
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: process.platform === "darwin",
        acceptFirstMouse: true,
        show: false,
        ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
        webPreferences,
      });
      mascot.setAlwaysOnTop(true, "screen-saver");
      mascot.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      mascot.once("ready-to-show", () => mascot?.showInactive());
      load(mascot, "mascot");
      placeMascot();
      screen.on("display-added", placeMascot);
      screen.on("display-removed", placeMascot);
      screen.on("display-metrics-changed", placeMascot);
      return mascot;
    },
    showDashboard(): void {
      if (!dashboard || dashboard.isDestroyed()) return;
      if (process.platform === "darwin") app.focus({ steal: true });
      dashboard.show();
      dashboard.focus();
    },
    /** The mascot renderer reports when the pointer is on the logo; only then it takes clicks. */
    setMascotPointer(sender: WebContents, inside: boolean): void {
      if (!mascot || sender !== mascot.webContents || !ignoreMouse) return;
      mascot.setIgnoreMouseEvents(!inside, { forward: true });
    },
    broadcast(state: UiState): void {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("octo:state", state);
      }
    },
  };
}

export type Windows = ReturnType<typeof createWindows>;
