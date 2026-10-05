import { useState } from "react";
import type { UiRemote } from "../shared/ui-state.js";

type Props = { remote: UiRemote; onClose: () => void };

/** The OpenRouter key: typed here once, then only its last four characters come back. */
export function Settings({ remote, onClose }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(remote.model ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function act(action: () => Promise<string | null>, done: string): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const failure = await action();
      if (failure) {
        setError(failure);
        return;
      }
      setApiKey("");
      setMessage(done);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings" aria-label="Impostazioni">
      <header>
        <h2>Impostazioni</h2>
        <button type="button" onClick={onClose}>
          Chiudi
        </button>
      </header>
      <h3>Analisi con OpenRouter</h3>
      <p className="muted">
        La chiave resta su questo computer, cifrata dal sistema. Octo invia a OpenRouter il testo
        letto dalle schermate solo quando lo chiedi per una sessione, mai le immagini.
      </p>
      <p>
        {remote.configured
          ? `Chiave configurata (…${remote.hint ?? ""})`
          : "Nessuna chiave configurata."}
      </p>
      {remote.problem ? <p role="alert">{remote.problem}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = model.trim();
          void act(
            () => window.octo.saveOpenRouter({ apiKey, ...(trimmed ? { model: trimmed } : {}) }),
            "Chiave verificata e salvata.",
          );
        }}
      >
        <label>
          Chiave API OpenRouter
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            maxLength={256}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label>
          Modello (facoltativo)
          <input
            type="text"
            spellCheck={false}
            value={model}
            maxLength={120}
            placeholder="vuoto = modello predefinito"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || remote.problem !== null || apiKey.trim().length === 0}
          >
            Salva
          </button>
          {remote.configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => window.octo.removeOpenRouter(), "Chiave rimossa.")}
            >
              Rimuovi
            </button>
          ) : null}
        </div>
      </form>
      {busy ? <p className="muted">Verifica con OpenRouter…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p className="note">{message}</p> : null}
    </section>
  );
}
