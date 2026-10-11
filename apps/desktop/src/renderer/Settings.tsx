import { useState } from "react";
import type { RemoteProvider } from "@octo/contracts";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";

type Props = { remote: UiRemote; onClose: () => void };

/** Each provider keeps its own encrypted key; activation is a separate explicit action. */
export function Settings({ remote, onClose }: Props) {
  const [provider, setProvider] = useState<RemoteProvider>(remote.provider ?? "openrouter");
  const saved = remote.providers[provider];
  const label = providerLabel(provider);
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState(saved.workspaceId ?? "");
  const [model, setModel] = useState(saved.model ?? "");
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
      <h3>Analisi remota</h3>
      <label htmlFor="remote-provider">Provider</label>
      <select
        id="remote-provider"
        value={provider}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value as RemoteProvider;
          setProvider(next);
          setApiKey("");
          setModel(remote.providers[next].model ?? "");
          setWorkspaceId(remote.providers[next].workspaceId ?? "");
          setError("");
          setMessage("");
        }}
      >
        <option value="openrouter">OpenRouter</option>
        <option value="anthropic">Claude (Anthropic)</option>
      </select>
      <p>{remote.provider === provider ? "Provider predefinito" : "Non predefinito"}</p>
      {remote.provider !== provider ? (
        <button
          type="button"
          disabled={busy || !saved.configured}
          onClick={() =>
            void act(() => window.octo.selectRemote(provider), "Provider predefinito aggiornato.")
          }
        >
          Usa come predefinito
        </button>
      ) : null}
      <p className="muted">
        La chiave resta su questo computer, cifrata dal sistema. Octo invia a {label} il testo letto
        dalle schermate solo quando lo chiedi per una sessione, mai le immagini.
      </p>
      <p>
        {saved.configured
          ? `Chiave configurata (…${saved.hint ?? ""})`
          : "Nessuna chiave configurata."}
      </p>
      {remote.problem ? <p role="alert">{remote.problem}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = model.trim();
          void act(
            () =>
              window.octo.saveRemote({
                provider,
                ...(provider === "anthropic" && workspaceId.trim()
                  ? { workspaceId: workspaceId.trim() }
                  : {}),
                apiKey: apiKey.trim(),
                ...(trimmed ? { model: trimmed } : {}),
              }),
            "Chiave verificata e salvata.",
          );
        }}
      >
        <label>
          Chiave API {label}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            maxLength={256}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {provider === "anthropic" ? (
          <label>
            Workspace Anthropic (facoltativo)
            <input
              type="text"
              value={workspaceId}
              maxLength={100}
              spellCheck={false}
              placeholder="wrkspc_…"
              onChange={(event) => setWorkspaceId(event.target.value)}
            />
            <span className="muted">
              Necessario solo se la chiave non è associata a un workspace.
            </span>
          </label>
        ) : null}
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
          {saved.configured ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => window.octo.removeRemote(provider), "Chiave rimossa.")}
            >
              Rimuovi
            </button>
          ) : null}
        </div>
      </form>
      {busy ? <p className="muted">Verifica con {label}…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p className="note">{message}</p> : null}
    </section>
  );
}
