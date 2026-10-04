export const PERMISSION_NOTE =
  "Octo non vede lo schermo: concedi il permesso Registrazione schermo in Impostazioni di Sistema > Privacy e sicurezza, poi riavvia Octo.";

/** One line after an analysis: model state, what was extracted, mini report. */
export function analysisNote(analysis: unknown, report: unknown): string {
  const extracted = analysis as {
    analysis?: string;
    episodes?: number;
    reason?: string | null;
    model?: string | null;
  };
  const written = report as { issued?: boolean; path?: string | null };
  const model = extracted.model
    ? `Ollama acceso (${extracted.model}).`
    : extracted.reason === "no_evidence"
      ? "Nessuna schermata letta."
      : "Ollama spento.";
  const episodes =
    extracted.reason === "accepted" || extracted.reason === "already_analyzed"
      ? `Attività riconosciute: ${extracted.episodes ?? 0}.`
      : "Nessuna attività riconosciuta.";
  const question = extracted.analysis === "awaiting_answer" ? " C'è una domanda per te." : "";
  const cadence = written.issued && written.path ? ` Mini report: ${written.path}` : "";
  return `${model} ${episodes}${question}${cadence}`;
}

export function describeError(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : "errore sconosciuto"}`;
}
