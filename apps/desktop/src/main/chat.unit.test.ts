import { describe, expect, it, vi } from "vitest";
import { initialUiState, type UiState } from "../shared/ui-state.js";
import { createChatControl, explainChatError, parseChatSend } from "./chat.js";
import { EngineError, type EngineRequest } from "./engine-client.js";

vi.mock("electron", () => ({ app: {} }));

const message = {
  messageId: "m1",
  sessionId: "s1",
  role: "assistant",
  text: "Hai inserito un ordine.",
  citations: [{ type: "episode", id: "episode-A", label: "Ordine" }],
  model: "mock",
  promptSchema: "chat@1",
  dataMode: "local_only",
  verified: true,
  partial: false,
  createdAt: "2026-01-15T08:00:00.000Z",
};

function stateWith(overrides: Partial<UiState>): UiState {
  return {
    ...initialUiState,
    remote: {
      ...initialUiState.remote,
      provider: "anthropic",
      model: "claude-test",
      workspaceId: null,
      available: true,
    },
    ...overrides,
  };
}

function fakeRequest(commands: Array<Record<string, unknown>>): EngineRequest {
  return async (command) => {
    commands.push(command);
    if (command.cmd === "chat.send") return { ok: true, result: { message } };
    if (command.cmd === "chat.history") return { ok: true, result: { messages: [message] } };
    return { ok: true, result: { approved: 1, total: 1 } };
  };
}

describe("session assistant control", () => {
  it("accepts a bounded question and the confirmed remote destination only", () => {
    expect(
      parseChatSend({ sessionId: "s1", text: "  Cosa ho fatto? ", mode: "local_only" }),
    ).toEqual({ sessionId: "s1", text: "Cosa ho fatto?", mode: "local_only" });
    expect(
      parseChatSend({
        sessionId: "s1",
        text: "Quanto?",
        mode: "cloud_after_review",
        remote: { provider: "anthropic", model: "claude-test", workspaceId: "wrkspc_1" },
      }),
    ).toEqual({
      sessionId: "s1",
      text: "Quanto?",
      mode: "cloud_after_review",
      remote: { provider: "anthropic", model: "claude-test", workspaceId: "wrkspc_1" },
    });
    expect(() => parseChatSend({ sessionId: "s1", text: " ", mode: "local_only" })).toThrow(
      "domanda non valida",
    );
    expect(() =>
      parseChatSend({ sessionId: "s1", text: "x".repeat(2_001), mode: "local_only" }),
    ).toThrow("domanda non valida");
    expect(() =>
      parseChatSend({ sessionId: "s1", text: "ciao", mode: "cloud_live_authorized" }),
    ).toThrow("modalità non valida");
    expect(() =>
      parseChatSend({ sessionId: "s1", text: "ciao", mode: "cloud_after_review" }),
    ).toThrow();
    expect(() => parseChatSend({ sessionId: "", text: "ciao", mode: "local_only" })).toThrow();
  });

  it("approves the session once before the first remote question and refuses stale destinations", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const control = createChatControl({
      request: fakeRequest(commands),
      state: () => stateWith({}),
      remoteBusy: () => false,
    });
    const cloud = {
      sessionId: "s1",
      text: "Quanto?",
      mode: "cloud_after_review",
      remote: { provider: "anthropic", model: "claude-test" },
    };
    await expect(control.send(cloud)).resolves.toEqual(message);
    await expect(control.send(cloud)).resolves.toEqual(message);
    expect(commands.map((command) => command.cmd)).toEqual([
      "review.approve",
      "chat.send",
      "chat.send",
    ]);
    expect(commands[1]).toEqual({
      cmd: "chat.send",
      sessionId: "s1",
      text: "Quanto?",
      mode: "cloud_after_review",
    });
    await expect(
      control.send({ ...cloud, remote: { provider: "openrouter", model: "claude-test" } }),
    ).rejects.toThrow("cambiati");
    await expect(control.history("s1")).resolves.toEqual([message]);
    expect(commands.at(-1)).toEqual({ cmd: "chat.history", sessionId: "s1" });
  });

  it("waits for a running analysis or a settings change, and explains engine codes in Italian", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const analysing = createChatControl({
      request: fakeRequest(commands),
      state: () => stateWith({ analyzingSessionId: "s9" }),
      remoteBusy: () => false,
    });
    await expect(
      analysing.send({ sessionId: "s1", text: "ciao", mode: "local_only" }),
    ).rejects.toThrow("analisi è in corso");
    const saving = createChatControl({
      request: fakeRequest(commands),
      state: () => stateWith({}),
      remoteBusy: () => true,
    });
    await expect(
      saving.send({
        sessionId: "s1",
        text: "ciao",
        mode: "cloud_after_review",
        remote: { provider: "anthropic", model: "claude-test" },
      }),
    ).rejects.toThrow("impostazioni");
    expect(commands).toHaveLength(0);

    const failing = createChatControl({
      request: async () => {
        throw new EngineError("session_active", "stop first");
      },
      state: () => stateWith({}),
      remoteBusy: () => false,
    });
    await expect(
      failing.send({ sessionId: "s1", text: "ciao", mode: "local_only" }),
    ).rejects.toThrow("Ferma la sessione");
    expect(explainChatError(new EngineError("weird", "x")).message).toBe(
      "L'assistente non è disponibile al momento.",
    );
    expect(explainChatError(new Error("boom")).message).toBe("boom");
  });
});
