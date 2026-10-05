import { MAX_ANALYSIS_BATCHES, MAX_BATCH_EVIDENCE } from "@octo/contracts/limits";
import { useState } from "react";
import { useAction } from "./useOcto.js";

type Props = { sessionId: string; evidenceCount: number };

/** At most two calls per batch (one retry), within the batch limit of an analysis. */
function maxRequests(evidenceCount: number): number {
  return (
    2 * Math.min(MAX_ANALYSIS_BATCHES, Math.max(1, Math.ceil(evidenceCount / MAX_BATCH_EVIDENCE)))
  );
}

/** Sending a session to OpenRouter always passes through a confirmation that says what leaves. */
export function RemoteAnalysis({ sessionId, evidenceCount }: Props) {
  const [confirming, setConfirming] = useState(false);
  const { run, error } = useAction();
  const screens = evidenceCount === 1 ? "1 schermata" : `${evidenceCount} schermate`;

  if (!confirming) {
    return (
      <button type="button" disabled={evidenceCount === 0} onClick={() => setConfirming(true)}>
        Analizza con OpenRouter
      </button>
    );
  }
  return (
    <section className="confirm" aria-label="Conferma invio a OpenRouter">
      <p>
        Verrà inviato a OpenRouter il testo letto da {screens} di questa sessione. Nessuna immagine
        lascia il computer e OpenRouter usa solo fornitori che non conservano i dati. Al massimo{" "}
        {maxRequests(evidenceCount)} richieste.
      </p>
      <p className="muted">
        Confermando approvi l'invio di tutta la sessione: l'approvazione resta registrata.
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            setConfirming(false);
            run(() => window.octo.analyzeRemote(sessionId));
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
