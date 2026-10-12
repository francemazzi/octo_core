import type { ReactNode } from "react";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";

type Props = {
  remote: UiRemote;
  evidenceCount: number;
  /** How many requests the confirmed action may make. */
  requestsNote: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

/** What leaves the computer, to whom and how often: confirmed before any remote call. */
export function RemoteConsent({
  remote,
  evidenceCount,
  requestsNote,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const label = providerLabel(remote.provider);
  const screens = evidenceCount === 1 ? "1 schermata" : `${evidenceCount} schermate`;
  return (
    <section className="confirm" aria-label={`Conferma invio a ${label}`}>
      <p>
        Verrà inviato a {label} ({remote.model}) il testo letto da {screens} di questa sessione.
        Nessuna immagine lascia il computer.{" "}
        {remote.provider === "openrouter"
          ? "OpenRouter usa solo fornitori che non conservano i dati."
          : "La conservazione dei dati dipende dalle condizioni del tuo account Anthropic."}{" "}
        {requestsNote}
      </p>
      {remote.workspaceId ? (
        <p className="muted">Workspace Anthropic: {remote.workspaceId}</p>
      ) : null}
      <p className="muted">
        Confermando approvi l'invio di tutta la sessione: l'approvazione resta registrata.
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={onConfirm}>
          Invia
        </button>
        <button type="button" onClick={onCancel}>
          Annulla
        </button>
      </div>
      {children}
    </section>
  );
}
