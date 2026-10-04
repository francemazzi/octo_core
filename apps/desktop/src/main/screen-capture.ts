import { desktopCapturer, screen, systemPreferences, type Display } from "electron";
import type { EngineRequest } from "./engine-client.js";

const MAX_IMAGE_SIDE = 2_048;

export type ScreenCapture = {
  /** `originMs` is the session start (wall clock), reused on resume so offsets keep growing. */
  start(sourceIds: string[], originMs: number): void;
  /** Stops the timer at once; the returned promise settles when the last screenshot is sent. */
  stop(): Promise<void>;
};

/** macOS asks for "Registrazione schermo" once; without it screenshots show only the wallpaper. */
export function screenPermission(): string {
  return process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : "granted";
}

/** `mon-1` is the primary display, then the others from left to right. */
export function orderedDisplays(): Display[] {
  const primary = screen.getPrimaryDisplay();
  const others = screen
    .getAllDisplays()
    .filter((display) => display.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x);
  return [primary, ...others];
}

/**
 * Takes a screenshot of each selected display every `intervalMs` and hands it to the engine,
 * which reads the text locally and drops the image. Ticks never overlap; `stop()` waits for
 * the last one so no frame reaches the engine after the session paused or stopped.
 */
export function createScreenCapture(
  request: EngineRequest,
  intervalMs: number,
  onError: (message: string) => void,
): ScreenCapture {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let selected: string[] = [];
  let startedAt = 0;

  async function tick(): Promise<void> {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE },
    });
    const displays = orderedDisplays();
    for (const sourceId of selected) {
      const index = Number(sourceId.replace("mon-", "")) - 1;
      const display = displays[index];
      const source =
        sources.find((item) => display && item.display_id === String(display.id)) ?? sources[index];
      if (!source || source.thumbnail.isEmpty()) continue;
      const offsetMs = Date.now() - startedAt;
      await request(
        {
          cmd: "capture.image",
          frameId: `scr-${startedAt}-${offsetMs}-${sourceId}`,
          sourceId,
          offsetMs,
          imageBase64: source.thumbnail.toJPEG(80).toString("base64"),
        },
        30_000,
      );
    }
  }

  function run(): void {
    if (running) return;
    running = tick()
      .catch((error: unknown) => {
        onError(
          error instanceof Error
            ? `Cattura non riuscita: ${error.message}`
            : "Cattura non riuscita.",
        );
      })
      .finally(() => {
        running = undefined;
      });
  }

  return {
    start(sourceIds, originMs) {
      if (timer) clearInterval(timer);
      selected = sourceIds;
      startedAt = originMs;
      run();
      timer = setInterval(run, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      return running ?? Promise.resolve();
    },
  };
}
