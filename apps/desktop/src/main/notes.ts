import { UNREADABLE_TEXT } from "../shared/readiness-text.js";

/** After Stop with neither a local model nor a remote key: nothing can analyse the session. */
export const NO_MODEL_NOTE =
  "Nessun modello per l'analisi: scaricane uno da «Prima di registrare» o inserisci una chiave nelle Impostazioni, poi premi Analizza.";

export const PERMISSION_NOTE =
  "Octo non vede lo schermo: concedi il permesso Registrazione schermo in Impostazioni di Sistema > Privacy e sicurezza, poi riavvia Octo.";

type AnalysisReply = {
  analysis?: string;
  episodes?: number;
  reason?: string | null;
  model?: string | null;
  partial?: boolean;
};

function modelLine(extracted: AnalysisReply, local: boolean, remoteLabel: string): string {
  if (extracted.reason === "reviewed_session") {
    return "Hai già confermato le attività: una nuova analisi non le sostituisce.";
  }
  if (extracted.model) {
    if (!local && extracted.reason === "already_analyzed")
      return `Analisi già presente (${extracted.model}).`;
    return local ? `Modello locale: ${extracted.model}.` : `${remoteLabel} (${extracted.model}).`;
  }
  if (extracted.reason === "no_evidence") return "Nessuna schermata letta.";
  if (extracted.reason === "unreadable_evidence") return UNREADABLE_TEXT;
  if (!local) return `${remoteLabel} non ha risposto.`;
  return extracted.reason === "model_unavailable"
    ? "Nessun modello locale disponibile (Ollama spento o senza modello)."
    : "Il modello locale non ha risposto.";
}

/** One line after an analysis: model state, what was extracted, coverage, mini report. */
export function analysisNote(
  analysis: unknown,
  report: unknown,
  mode = "local_only",
  remoteLabel = "OpenRouter",
): string {
  const extracted = analysis as AnalysisReply;
  const written = report as { issued?: boolean; path?: string | null };
  const accepted = extracted.reason === "accepted" || extracted.reason === "already_analyzed";
  const episodes = accepted
    ? `Attività riconosciute: ${extracted.episodes ?? 0}.`
    : (extracted.episodes ?? 0) > 0
      ? "Restano le attività di prima."
      : "Nessuna attività riconosciuta.";
  const partial = extracted.partial
    ? " Analisi parziale: la sessione è troppo lunga per essere letta tutta."
    : "";
  const question = extracted.analysis === "awaiting_answer" ? " C'è una domanda per te." : "";
  const cadence = written.issued && written.path ? ` Mini report: ${written.path}` : "";
  return `${modelLine(extracted, mode === "local_only", remoteLabel)} ${episodes}${partial}${question}${cadence}`;
}

export function describeError(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : "errore sconosciuto"}`;
}
