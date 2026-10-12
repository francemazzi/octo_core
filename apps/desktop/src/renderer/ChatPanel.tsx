import { MAX_BATCH_EVIDENCE, MAX_CHAT_TEXT_CHARS } from "@octo/contracts/limits";
import type { ChatMessage, ChatMode } from "@octo/contracts";
import { useEffect, useState } from "react";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";
import { RemoteConsent } from "./RemoteConsent.js";

type Props = {
  sessionId: string;
  evidenceCount: number;
  remote: UiRemote;
  /** An analysis is running: the engine's slow lane is taken. */
  busy: boolean;
};

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Operazione non riuscita.";
}

function remoteTarget(remote: UiRemote) {
  return {
    provider: remote.provider!,
    model: remote.model!,
    ...(remote.workspaceId ? { workspaceId: remote.workspaceId } : {}),
  };
}

function citationText(citation: ChatMessage["citations"][number]): string {
  const label = citation.label ?? citation.id;
  return citation.type === "episode" ? `Attività: ${label}` : label;
}

/**
 * Questions about a stopped session, answered with citations the engine verified. The first
 * remote question of a session asks for the same consent as a remote analysis.
 */
export function ChatPanel({ sessionId, evidenceCount, remote, busy }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("local_only");
  const [consented, setConsented] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const cloudAllowed = remote.available && remote.provider !== null && remote.model !== null;

  useEffect(() => {
    let current = true;
    window.octo
      .chatHistory(sessionId)
      .then((history) => {
        if (current) setMessages(history);
      })
      .catch((failure: unknown) => {
        if (current) setError(describe(failure));
      });
    return () => {
      current = false;
    };
  }, [sessionId]);

  async function ask(question: string, cloud: boolean): Promise<void> {
    setSending(true);
    setError("");
    try {
      await window.octo.chatSend({
        sessionId,
        text: question,
        mode: cloud ? "cloud_after_review" : "local_only",
        ...(cloud ? { remote: remoteTarget(remote) } : {}),
      });
      setMessages(await window.octo.chatHistory(sessionId));
      setText("");
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setSending(false);
    }
  }

  function submit(): void {
    const question = text.trim();
    if (question.length === 0 || sending || busy) return;
    const cloud = mode === "cloud_after_review";
    if (cloud && !consented) {
      setConfirming(true);
      return;
    }
    void ask(question, cloud);
  }

  return (
    <section className="chat" aria-label="Assistente della sessione">
      <h2>Assistente della sessione</h2>
      {messages.length === 0 ? (
        <p className="muted">
          Chiedi qualcosa su questa sessione: l'assistente risponde citando attività e schermate.
        </p>
      ) : null}
      <ol className="chat-log">
        {messages.map((message) => (
          <li key={message.messageId} className={message.role}>
            <p>{message.text}</p>
            {message.role === "assistant" ? (
              <div className="meta">
                {message.citations.length > 0 ? (
                  <ul className="citations" aria-label="Citazioni">
                    {message.citations.map((citation) => (
                      <li key={`${citation.type}:${citation.id}`}>{citationText(citation)}</li>
                    ))}
                  </ul>
                ) : null}
                {!message.verified ? <span className="badge">non verificata</span> : null}
                {message.partial ? (
                  <span className="muted">
                    Contesto parziale: l'assistente non ha potuto leggere tutte le schermate (al
                    massimo {MAX_BATCH_EVIDENCE}, e nessuna di una sessione precedente al riavvio).
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {confirming ? (
        <RemoteConsent
          remote={remote}
          evidenceCount={evidenceCount}
          requestsNote="Una richiesta per ogni domanda."
          onConfirm={() => {
            setConfirming(false);
            setConsented(true);
            void ask(text.trim(), true);
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Domanda per l'assistente"
          value={text}
          maxLength={MAX_CHAT_TEXT_CHARS}
          rows={2}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="actions">
          {cloudAllowed ? (
            <select
              aria-label="Modello dell'assistente"
              value={mode}
              disabled={sending}
              onChange={(event) => setMode(event.target.value as ChatMode)}
            >
              <option value="local_only">Ollama (locale)</option>
              <option value="cloud_after_review">{providerLabel(remote.provider)}</option>
            </select>
          ) : null}
          <button
            type="submit"
            className="primary"
            disabled={sending || busy || text.trim().length === 0}
          >
            Chiedi
          </button>
          {sending ? <span className="muted">L'assistente sta leggendo la sessione…</span> : null}
        </div>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
