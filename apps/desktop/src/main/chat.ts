import {
  CHAT_TIMEOUT_MS,
  MAX_CHAT_TEXT_CHARS,
  chatHistoryResultSchema,
  chatSendResultSchema,
  remoteAnalysisInputSchema,
  type ChatMessage,
} from "@octo/contracts";
import type { ChatSendInput, UiState } from "../shared/ui-state.js";
import { EngineError, type EngineRequest } from "./engine-client.js";
import { parseId } from "./questions.js";
import { assertRemoteUnchanged } from "./remote-guard.js";

/** The renderer is untrusted input: the question is bounded and the mode is one of two. */
export function parseChatSend(payload: unknown): ChatSendInput {
  const record = (payload ?? {}) as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (text.length === 0 || text.length > MAX_CHAT_TEXT_CHARS) throw new Error("domanda non valida");
  const sessionId = parseId(record.sessionId, "sessione");
  if (record.mode === "local_only") return { sessionId, text, mode: "local_only" };
  if (record.mode !== "cloud_after_review") throw new Error("modalità non valida");
  const remote = typeof record.remote === "object" && record.remote !== null ? record.remote : {};
  const target = remoteAnalysisInputSchema.parse({ sessionId, ...remote });
  return {
    sessionId,
    text,
    mode: "cloud_after_review",
    remote: {
      provider: target.provider,
      model: target.model,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    },
  };
}

const ENGINE_MESSAGES: Record<string, string> = {
  session_active: "Ferma la sessione prima di chiedere all'assistente.",
  model_unavailable: "Ollama è spento o non ha un modello: l'assistente locale non può rispondere.",
  remote_unavailable: "Nessun provider remoto configurato.",
  invalid_model_output: "L'assistente non ha dato una risposta leggibile. Riprova.",
  remote_unreachable: "Il provider remoto non risponde: controlla la connessione e riprova.",
  invalid_key: "Il provider ha rifiutato la chiave.",
  remote_rejected: "Il provider ha rifiutato la richiesta.",
};

/** Engine codes become one Italian sentence; nothing else about the failure reaches the window. */
export function explainChatError(error: unknown): Error {
  if (error instanceof EngineError) {
    return new Error(ENGINE_MESSAGES[error.code] ?? "L'assistente non è disponibile al momento.");
  }
  return error instanceof Error ? error : new Error("Operazione non riuscita.");
}

export type ChatControlDeps = {
  request: EngineRequest;
  state: () => UiState;
  /** Settings are being saved: the destination may be about to change. */
  remoteBusy: () => boolean;
};

/**
 * One question at a time to the engine's slow lane. A remote question first approves the
 * evidence of the session, once per session per process, like a remote analysis.
 */
export function createChatControl(deps: ChatControlDeps) {
  const approved = new Set<string>();
  return {
    async send(payload: unknown): Promise<ChatMessage> {
      const input = parseChatSend(payload);
      const state = deps.state();
      if (state.analyzingSessionId) {
        throw new Error("Un'analisi è in corso: riprova quando finisce.");
      }
      const cloud = input.mode === "cloud_after_review";
      if (cloud) {
        if (deps.remoteBusy()) throw new Error("Attendi il salvataggio delle impostazioni.");
        if (!input.remote) throw new Error("destinazione mancante");
        assertRemoteUnchanged(state.remote, input.remote);
      }
      try {
        if (cloud && !approved.has(input.sessionId)) {
          await deps.request({ cmd: "review.approve", sessionId: input.sessionId });
          approved.add(input.sessionId);
        }
        const reply = await deps.request(
          { cmd: "chat.send", sessionId: input.sessionId, text: input.text, mode: input.mode },
          CHAT_TIMEOUT_MS,
        );
        return chatSendResultSchema.parse(reply.result).message;
      } catch (error) {
        throw explainChatError(error);
      }
    },
    async history(payload: unknown): Promise<ChatMessage[]> {
      const sessionId = parseId(payload, "sessione");
      const reply = await deps.request({ cmd: "chat.history", sessionId });
      return chatHistoryResultSchema.parse(reply.result).messages;
    },
  };
}

export type ChatControl = ReturnType<typeof createChatControl>;
