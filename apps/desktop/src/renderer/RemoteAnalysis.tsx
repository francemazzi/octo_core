import { MAX_ANALYSIS_BATCHES, MAX_BATCH_EVIDENCE } from "@octo/contracts/limits";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";
import { useState } from "react";
import { useAction } from "./useOcto.js";

type Props = { sessionId: string; evidenceCount: number; remote: UiRemote };

/** At most two calls per batch (one retry), within the batch limit of an analysis. */
function maxRequests(evidenceCount: number): number {
  return (
    2 * Math.min(MAX_ANALYSIS_BATCHES, Math.max(1, Math.ceil(evidenceCount / MAX_BATCH_EVIDENCE)))
  );
}

/** Confirm the exact destination before sending; a provider/model change remounts this panel. */
export function RemoteAnalysis({ sessionId, evidenceCount, remote }: Props) {
  const label = providerLabel(remote.provider);
  const [confirming, setConfirming] = useState(false);
  const { run, error } = useAction();
  const screens = evidenceCount === 1 ? "1 schermata" : `${evidenceCount} schermate`;

  if (!confirming) {
    return (
      <button type="button" disabled={evidenceCount === 0} onClick={() => setConfirming(true)}>
        Analizza con {label}
      </button>
    );
  }
  return (
    <section className="confirm" aria-label={`Conferma invio a ${label}`}>
      <p>
        Verrà inviato a {label} ({remote.model}) il testo letto da {screens} di questa sessione.
        Nessuna immagine lascia il computer.{" "}
        {remote.provider === "openrouter"
          ? "OpenRouter usa solo fornitori che non conservano i dati."
          : "La conservazione dei dati dipende dalle condizioni del tuo account Anthropic."}{" "}
        Al massimo {maxRequests(evidenceCount)} richieste.
      </p>
      {remote.workspaceId ? (
        <p className="muted">Workspace Anthropic: {remote.workspaceId}</p>
      ) : null}
      <p className="muted">
        Confermando approvi l'invio di tutta la sessione: l'approvazione resta registrata.
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            setConfirming(false);
            run(() =>
              window.octo.analyzeRemote({
                sessionId,
                provider: remote.provider!,
                model: remote.model!,
                ...(remote.workspaceId ? { workspaceId: remote.workspaceId } : {}),
              }),
            );
          }}
        >
          Invia
        </button>
        <button type="button" onClick={() => setConfirming(false)}>
          Annulla
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
