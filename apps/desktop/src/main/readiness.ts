import {
  captureImageResultSchema,
  pullRoleSchema,
  readinessSchema,
  type CaptureMode,
  type OcrBlockingError,
  type Readiness,
} from "@octo/contracts";
import { readinessProblem, type PauseCause } from "../shared/readiness-text.js";
import type { EngineRequest } from "./engine-client.js";

/** The only page Octo opens for Ollama: never a URL from the renderer. */
export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
/** While something is missing or downloading, the list updates by itself every few seconds. */
const POLL_WAITING_MS = 2_000;
const POLL_READY_MS = 15_000;

/** Failures in a row before the automatic pause: a stopped daemon after two, slowness after three. */
const PAUSE_AFTER: Record<OcrBlockingError, number> = {
  ollama_unreachable: 2,
  ocr_model_missing: 2,
  remote_model: 2,
  ollama_timeout: 3,
};
const PAUSE_CAUSE: Record<OcrBlockingError, PauseCause> = {
  ollama_unreachable: "ollama",
  ocr_model_missing: "ocr_model",
  remote_model: "remote_model",
  ollama_timeout: "ocr_slow",
};

/** Reads the reply of one screenshot: a cause once reading has failed often enough in a row. */
export function pauseCauseFor(payload: unknown): PauseCause | null {
  const parsed = captureImageResultSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { accepted, reason, ocr } = parsed.data;
  if (!accepted && reason === "ocr_unavailable") return "ocr_unavailable";
  if (!ocr.lastError) return null;
  return ocr.consecutiveFailures >= PAUSE_AFTER[ocr.lastError] ? PAUSE_CAUSE[ocr.lastError] : null;
}

/** After Stop: the local model analyses at once; with only a remote one, its consent opens. */
export function afterStopAction(
  readiness: Readiness | null,
  remoteAvailable: boolean,
): "local" | "consent" | "none" {
  if (readiness?.localModel) return "local";
  return remoteAvailable ? "consent" : "none";
}

export type ReadinessDeps = {
  request: EngineRequest;
  capture: CaptureMode;
  publish: (readiness: Readiness) => void;
  openExternal: (url: string) => Promise<void>;
};

function logFailure(error: unknown): void {
  process.stderr.write(`readiness check failed: ${error instanceof Error ? error.message : ""}\n`);
}

/**
 * Keeps the list "Prima di registrare" current: asks the engine what this computer has, publishes
 * only changes, and refuses Avvia or Riprendi with one sentence while something is missing.
 */
export function createReadinessControl(deps: ReadinessDeps) {
  let current: Readiness | null = null;
  let published = "";
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function refresh(): Promise<Readiness> {
    const reply = await deps.request({ cmd: "readiness.status", capture: deps.capture });
    const next = readinessSchema.parse(reply.result);
    current = next;
    const text = JSON.stringify(next);
    if (text !== published) {
      published = text;
      deps.publish(next);
    }
    return next;
  }

  function interval(): number {
    return !current?.ready || current.pull?.status === "running" ? POLL_WAITING_MS : POLL_READY_MS;
  }

  function schedule(): void {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(() => {
      refresh().catch(logFailure).finally(schedule);
    }, interval());
    timer.unref();
  }

  return {
    current: (): Readiness | null => current,
    refresh,
    async ensureReady(): Promise<void> {
      const readiness = await refresh();
      if (!readiness.ready) throw new Error(readinessProblem(readiness.missing));
    },
    /** Only a role crosses IPC: the engine decides which model it means. */
    async pull(payload: unknown): Promise<void> {
      const role = pullRoleSchema.safeParse(payload);
      if (!role.success) throw new Error("Modello non valido.");
      await deps.request({ cmd: "model.pull", role: role.data });
      await refresh();
      schedule();
    },
    installOllama: (): Promise<void> => deps.openExternal(OLLAMA_DOWNLOAD_URL),
    start(): void {
      if (running) return;
      running = true;
      refresh().catch(logFailure).finally(schedule);
    },
    stop(): void {
      running = false;
      clearTimeout(timer);
    },
  };
}

export type ReadinessControl = ReturnType<typeof createReadinessControl>;
