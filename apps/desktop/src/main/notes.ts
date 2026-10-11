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
    return local ? `Ollama acceso (${extracted.model}).` : `${remoteLabel} (${extracted.model}).`;
  }
  if (extracted.reason === "no_evidence") return "Nessuna schermata letta.";
  return local ? "Ollama spento." : `${remoteLabel} non ha risposto.`;
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
