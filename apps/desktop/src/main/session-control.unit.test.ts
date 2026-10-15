import type { Readiness } from "@octo/contracts";
import { describe, expect, it } from "vitest";
import { initialUiState } from "../shared/ui-state.js";
import type { EngineRequest } from "./engine-client.js";
import { NO_MODEL_NOTE } from "./notes.js";
import { createSessionControl } from "./session-control.js";

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

function setup() {
  const commands: string[] = [];
  const request: EngineRequest = async (command) => {
    commands.push(String(command.cmd));
    switch (command.cmd) {
      case "session.list":
        return { ok: true, result: { sessions: [] } };
      case "question.list":
        return { ok: true, result: { questions: [] } };
      case "session.start":
        return { ok: true, result: { sessionId: "s1", startedWall: "2026-10-13T10:00:00.000Z" } };
      case "analysis.run":
        return { ok: true, result: { reason: "accepted", episodes: 1, model: "qwen3.5:4b" } };
      default:
        return { ok: true, result: {} };
    }
  };
  const world = { readiness: READY as Readiness, attention: 0, capturing: false };
  const control = createSessionControl({
    request,
    capture: {
      start: () => {
        world.capturing = true;
      },
      stop: async () => {
        world.capturing = false;
      },
    },
    synthetic: false,
    readiness: {
      current: () => world.readiness,
      ensureReady: async () => {
        if (!world.readiness.ready) throw new Error("Prima di registrare: Ollama non risponde.");
      },
    },
    sources: () => [{ id: "mon-1", label: "Schermo 1" }],
    screenAllowed: () => true,
    publish: () => undefined,
    attention: () => {
      world.attention += 1;
    },
  });
  return { control, commands, world };
}

const failing = (count: number) => ({
  accepted: true,
  reason: "queued",
  ocr: { consecutiveFailures: count, lastError: "ollama_unreachable" },
});

describe("recording control", () => {
  it("does not start while the list «Prima di registrare» is incomplete", async () => {
    const { control, commands, world } = setup();
    world.readiness = { ...READY, ollama: { reachable: false }, missing: ["ollama"], ready: false };
    await control.start(["mon-1"]);
    expect(control.state.error).toBe(
      "Avvio non riuscito: Prima di registrare: Ollama non risponde.",
    );
    expect(commands).not.toContain("session.start");
    expect(control.state.capture).toBe("idle");
  });

  it("pauses once when reading keeps failing, and resumes only when ready again", async () => {
    const { control, commands, world } = setup();
    await control.start(["mon-1"]);
    expect(control.state.capture).toBe("recording");
    control.captureReply(failing(1));
    expect(commands).not.toContain("session.pause");
    control.captureReply(failing(2));
    control.captureReply(failing(3));
    await new Promise((done) => setTimeout(done, 0));
    expect(commands.filter((command) => command === "session.pause")).toHaveLength(1);
    expect(control.state).toMatchObject({ capture: "paused", pauseCause: "ollama" });
    expect(world.attention).toBe(1);
    expect(world.capturing).toBe(false);

    world.readiness = { ...READY, ollama: { reachable: false }, missing: ["ollama"], ready: false };
    await control.resume();
    expect(control.state.error).toContain("Ripresa non riuscita: Prima di registrare");
    expect(commands).not.toContain("session.resume");
    world.readiness = READY;
    await control.resume();
    expect(control.state).toMatchObject({ capture: "recording", pauseCause: null, error: null });
    expect(world.capturing).toBe(true);
  });

  it("names the provider that read the last screenshot, and a local read clears it", async () => {
    const { control } = setup();
    await control.start(["mon-1"]);
    control.captureReply({
      accepted: true,
      reason: "queued",
      ocr: { consecutiveFailures: 0, lastError: null, fallback: "anthropic" },
    });
    expect(control.state.ocrFallback).toBe("anthropic");
    expect(control.state.capture).toBe("recording");
    control.captureReply({
      accepted: true,
      reason: "queued",
      ocr: { consecutiveFailures: 0, lastError: null, fallback: null },
    });
    expect(control.state.ocrFallback).toBeNull();
  });

  it("clears the previous note when a recording starts", async () => {
    const { control } = setup();
    control.state.note = "Nessuna schermata letta. Nessuna attività riconosciuta.";
    await control.start(["mon-1"]);
    expect(control.state.capture).toBe("recording");
    expect(control.state.note).toBe("");
  });

  it("after Stop analyses locally, or opens the remote consent, or says no model can", async () => {
    const local = setup();
    await local.control.start(["mon-1"]);
    await local.control.stop();
    await new Promise((done) => setTimeout(done, 0));
    expect(local.commands).toContain("analysis.run");

    const remote = setup();
    remote.world.readiness = { ...READY, localModel: null };
    remote.control.state.remote = { ...initialUiState.remote, available: true };
    await remote.control.start(["mon-1"]);
    await remote.control.stop();
    expect(remote.commands).not.toContain("analysis.run");
    expect(remote.control.state.focus).toMatchObject({ sessionId: "s1", consent: true });
    expect(remote.world.attention).toBe(1);

    const none = setup();
    none.world.readiness = { ...READY, localModel: null };
    await none.control.start(["mon-1"]);
    await none.control.stop();
    expect(none.commands).not.toContain("analysis.run");
    expect(none.control.state.note).toBe(NO_MODEL_NOTE);
  });
});
