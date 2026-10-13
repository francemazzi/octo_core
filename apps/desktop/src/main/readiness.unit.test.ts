import type { Readiness } from "@octo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineRequest } from "./engine-client.js";
import {
  afterStopAction,
  createReadinessControl,
  OLLAMA_DOWNLOAD_URL,
  pauseCauseFor,
} from "./readiness.js";

const READY: Readiness = {
  capture: "screen",
  keystore: true,
  ollama: { reachable: true },
  ocr: { model: "glm-ocr", installed: true, local: true },
  localModel: "qwen3.5:4b",
  remote: null,
  pullable: ["ocr", "chat"],
  pull: null,
  missing: [],
  ready: true,
};
const MISSING: Readiness = {
  ...READY,
  ollama: { reachable: false },
  ocr: { model: "glm-ocr", installed: false, local: false },
  localModel: null,
  missing: ["ollama", "ocr_model", "analysis_model"],
  ready: false,
};

function reply(consecutiveFailures: number, lastError: string | null, accepted = true) {
  return {
    accepted,
    reason: accepted ? "queued" : "ocr_unavailable",
    ocr: { consecutiveFailures, lastError },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readiness control", () => {
  it("pauses after two failures of a stopped Ollama and after three timeouts", () => {
    expect(pauseCauseFor(reply(0, null))).toBeNull();
    expect(pauseCauseFor(reply(1, "ollama_unreachable"))).toBeNull();
    expect(pauseCauseFor(reply(2, "ollama_unreachable"))).toBe("ollama");
    expect(pauseCauseFor(reply(2, "ocr_model_missing"))).toBe("ocr_model");
    expect(pauseCauseFor(reply(2, "remote_model"))).toBe("remote_model");
    expect(pauseCauseFor(reply(2, "ollama_timeout"))).toBeNull();
    expect(pauseCauseFor(reply(3, "ollama_timeout"))).toBe("ocr_slow");
    expect(pauseCauseFor(reply(0, null, false))).toBe("ocr_unavailable");
    expect(pauseCauseFor({ accepted: true })).toBeNull();
  });

  it("analyses locally after Stop, else asks for the remote consent, else nothing", () => {
    expect(afterStopAction(READY, true)).toBe("local");
    expect(afterStopAction({ ...READY, localModel: null }, true)).toBe("consent");
    expect(afterStopAction({ ...READY, localModel: null }, false)).toBe("none");
    expect(afterStopAction(null, false)).toBe("none");
  });

  it("refuses with one sentence, polls while something is missing, and opens only Ollama's page", async () => {
    vi.useFakeTimers();
    let current = MISSING;
    const commands: Array<Record<string, unknown>> = [];
    const request: EngineRequest = async (command) => {
      commands.push(command);
      return { ok: true, result: command.cmd === "readiness.status" ? current : {} };
    };
    const published: Readiness[] = [];
    const opened: string[] = [];
    const control = createReadinessControl({
      request,
      capture: "screen",
      publish: (next) => published.push(next),
      openExternal: async (url) => {
        opened.push(url);
      },
    });
    await expect(control.ensureReady()).rejects.toThrow(
      "Prima di registrare: Ollama non risponde: installalo e avvialo. Manca il modello",
    );
    control.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(published).toHaveLength(1);
    current = READY;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(published.at(-1)?.ready).toBe(true);
    await expect(control.ensureReady()).resolves.toBeUndefined();
    const checks = commands.filter((command) => command.cmd === "readiness.status").length;
    await vi.advanceTimersByTimeAsync(14_000);
    expect(commands.filter((command) => command.cmd === "readiness.status")).toHaveLength(checks);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(commands.filter((command) => command.cmd === "readiness.status")).toHaveLength(
      checks + 1,
    );
    control.stop();

    await control.installOllama();
    expect(opened).toEqual([OLLAMA_DOWNLOAD_URL]);
    await expect(control.pull("evil")).rejects.toThrow("Modello non valido.");
    await control.pull("ocr");
    expect(commands).toContainEqual({ cmd: "model.pull", role: "ocr" });
    expect(commands.some((command) => "model" in command)).toBe(false);
  });
});
