import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, shell } from "electron";
import type { UiUpdate } from "../shared/ui-state.js";

const LATEST_URL = "https://api.github.com/repos/francemazzi/octo_core/releases/latest";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15_000;

export type ReleaseAsset = { name: string; browser_download_url: string; size?: number };
export type Release = { tag_name: string; assets: ReleaseAsset[] };

const NONE: UiUpdate = { status: "none", version: null, progress: null, message: null };

function parts(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `latest` is a higher version than `current` ("1.10.0" > "1.9.0"). */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** The package for this computer: the dmg on macOS, the zip elsewhere. */
export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  arch: string,
): ReleaseAsset | undefined {
  const label = `${platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux"}-${arch}`;
  const extension = platform === "darwin" ? ".dmg" : ".zip";
  return assets.find((asset) => asset.name.endsWith(`-${label}${extension}`));
}

function isGithubDownload(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" && (hostname === "github.com" || hostname.endsWith(".github.com"));
}

/**
 * Looks for a newer GitHub release, now and every few hours. The button downloads the package
 * for this computer into Downloads and opens it: builds are unsigned, so the system's own
 * installer step (drag to Applications, unzip) stays with the user.
 */
export function createUpdater(deps: { publish: (update: UiUpdate) => void }) {
  let update: UiUpdate = NONE;
  let asset: ReleaseAsset | undefined;
  let busy = false;

  function set(next: UiUpdate): void {
    update = next;
    deps.publish(update);
  }

  async function check(): Promise<void> {
    if (busy || update.status === "ready") return;
    try {
      const response = await fetch(LATEST_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const release = (await response.json()) as Release;
      const found = pickAsset(release.assets ?? [], process.platform, process.arch);
      if (!found || !isNewer(release.tag_name, app.getVersion())) {
        if (update.status !== "none") set(NONE);
        return;
      }
      asset = found;
      set({
        status: "available",
        version: release.tag_name.replace(/^v/, ""),
        progress: null,
        message: null,
      });
    } catch {
      // Offline or rate limited: the next check retries, the app keeps working.
    }
  }

  async function install(): Promise<void> {
    if (busy || !asset || update.status === "none") return;
    busy = true;
    const version = update.version;
    const chosen = asset;
    try {
      if (!isGithubDownload(chosen.browser_download_url)) throw new Error("origine non valida");
      set({ status: "downloading", version, progress: 0, message: null });
      const response = await fetch(chosen.browser_download_url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length")) || chosen.size || 0;
      const directory = app.getPath("downloads");
      await mkdir(directory, { recursive: true });
      const target = join(directory, chosen.name);
      const partial = `${target}.part`;
      let received = 0;
      let last = -1;
      const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      source.on("data", (chunk: Buffer) => {
        received += chunk.length;
        const progress = total ? Math.min(99, Math.floor((received / total) * 100)) : null;
        if (progress !== last) {
          last = progress ?? -1;
          set({ status: "downloading", version, progress, message: null });
        }
      });
      try {
        await pipeline(source, createWriteStream(partial));
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      set({
        status: "ready",
        version,
        progress: 100,
        message:
          process.platform === "darwin"
            ? "Trascina Octo Core nella cartella Applicazioni e riaprilo."
            : "Chiudi Octo, estrai l'archivio scaricato e avvia la nuova versione.",
      });
      if (process.platform === "darwin") await shell.openPath(target);
      else shell.showItemInFolder(target);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "errore sconosciuto";
      set({
        status: "error",
        version,
        progress: null,
        message: `Download non riuscito (${reason}).`,
      });
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  timer.unref();

  return { check, install };
}
