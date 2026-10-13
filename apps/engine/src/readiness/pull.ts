import type { PullRole, PullState } from "@octo/contracts";
import { z } from "zod";
import { ndjsonLines } from "../analysis/ndjson.js";
import { ollamaFetch } from "../analysis/ollama.js";
import { OctoError } from "../errors.js";

/** No progress line for this long: the download is stuck, not slow. */
const STALL_MS = 120_000;

const pullChunkSchema = z.object({
  status: z.string().optional(),
  digest: z.string().optional(),
  total: z.number().nonnegative().optional(),
  completed: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

export type ModelPullDeps = {
  base: string;
  /** The allowlist: the only model each role may download. */
  models: Record<PullRole, string>;
  audit: (detail: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
  stallMs?: number;
};

export type ModelPull = {
  start(role: PullRole): PullState;
  status(): PullState | null;
};

type Layer = { completed: number; total: number };

function failure(error: unknown, stalled: boolean): NonNullable<PullState["error"]> {
  if (stalled) return "pull_stalled";
  if (error instanceof OctoError && error.code.startsWith("ollama_")) return "ollama_unreachable";
  return "pull_failed";
}

/**
 * Asks the local Ollama to download one model of the allowlist, one at a time, and keeps its
 * progress for the dashboard. Ollama fetches the weights from its registry: no evidence leaves.
 */
export function createModelPull(deps: ModelPullDeps): ModelPull {
  let state: PullState | null = null;

  function progress(layers: Map<string, Layer>): void {
    if (!state) return;
    const values = [...layers.values()];
    const total = values.reduce((sum, layer) => sum + layer.total, 0);
    const completed = values.reduce(
      (sum, layer) => sum + Math.min(layer.completed, layer.total),
      0,
    );
    state = { ...state, completedBytes: completed, totalBytes: total > 0 ? total : null };
  }

  async function run(model: string, controller: AbortController, alive: () => void) {
    const response = await ollamaFetch(
      `${deps.base}/api/pull`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: controller.signal,
      },
      deps.fetchImpl,
    );
    if (!response.ok || !response.body) {
      throw new OctoError("pull_failed", `ollama ${response.status}`);
    }
    const layers = new Map<string, Layer>();
    let success = false;
    for await (const line of ndjsonLines(response.body, controller.signal)) {
      alive();
      const chunk = pullChunkSchema.parse(JSON.parse(line));
      if (chunk.error) throw new OctoError("pull_failed", chunk.error.slice(0, 200));
      if (chunk.digest && chunk.total) {
        layers.set(chunk.digest, { total: chunk.total, completed: chunk.completed ?? 0 });
        progress(layers);
      }
      if (chunk.status === "success") success = true;
    }
    if (!success) throw new OctoError("pull_failed", "the download ended before success");
  }

  return {
    start(role) {
      if (state?.status === "running") throw new OctoError("pull_busy", "a download is running");
      const model = deps.models[role];
      state = {
        role,
        model,
        status: "running",
        completedBytes: 0,
        totalBytes: null,
        error: null,
      };
      deps.audit({ role, model, outcome: "started" });
      const controller = new AbortController();
      let stalled = false;
      let watchdog: NodeJS.Timeout | undefined;
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          stalled = true;
          controller.abort();
        }, deps.stallMs ?? STALL_MS);
        watchdog.unref();
      };
      alive();
      void run(model, controller, alive)
        .then(() => {
          if (!state) return;
          const done = state.totalBytes ?? state.completedBytes;
          state = { ...state, status: "completed", completedBytes: done };
          deps.audit({ role, model, outcome: "completed" });
        })
        .catch((error: unknown) => {
          const code = failure(error, stalled);
          if (state) state = { ...state, status: "failed", error: code };
          deps.audit({ role, model, outcome: "failed", error: code });
        })
        .finally(() => clearTimeout(watchdog));
      return state;
    },
    status() {
      return state;
    },
  };
}
