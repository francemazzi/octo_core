import type { PullState, ReadinessRequirement, RemoteProvider } from "@octo/contracts";

/** Why Octo paused a recording on its own: reading the screenshots stopped working. */
export type PauseCause = "ollama" | "ocr_model" | "remote_model" | "ocr_slow" | "ocr_unavailable";

export const PAUSE_TEXT: Record<PauseCause, string> = {
  ollama: "Registrazione in pausa: Ollama non risponde. Riavvialo, poi premi Riprendi.",
  ocr_model:
    "Registrazione in pausa: manca il modello che legge le schermate. Scaricalo da «Prima di registrare», poi premi Riprendi.",
  remote_model:
    "Registrazione in pausa: il modello che legge le schermate gira fuori da questo computer. Scarica la copia locale, poi premi Riprendi.",
  ocr_slow:
    "Registrazione in pausa: il computer è troppo lento per leggere le schermate. Chiudi i programmi pesanti, poi premi Riprendi.",
  ocr_unavailable:
    "Registrazione in pausa: in questa installazione la lettura delle schermate è spenta.",
};

export const MISSING_TEXT: Record<ReadinessRequirement, string> = {
  keystore: "Questo computer non offre un archivio sicuro per la chiave delle schermate.",
  ollama: "Ollama non risponde: installalo e avvialo.",
  ocr_model: "Manca il modello che legge le schermate.",
  analysis_model: "Serve un modello per l'analisi: scaricane uno locale o inserisci una chiave.",
};

export const PULL_ERROR_TEXT: Record<NonNullable<PullState["error"]>, string> = {
  ollama_unreachable: "Download interrotto: Ollama non risponde.",
  pull_failed: "Download non riuscito: controlla la connessione e lo spazio su disco, poi riprova.",
  pull_stalled: "Download fermo da troppo tempo: riprova.",
};

/** Shown while recording, after glm-ocr failed and the configured provider read the screenshot. */
export function ocrFallbackText(provider: RemoteProvider): string {
  const name = provider === "anthropic" ? "Claude" : "OpenRouter";
  return `Lettura passata a ${name}: il provider non conserva i dati.`;
}

/** One sentence for Avvia or Riprendi refused: everything the list still misses. */
export function readinessProblem(missing: readonly ReadinessRequirement[]): string {
  return `Prima di registrare: ${missing.map((item) => MISSING_TEXT[item]).join(" ")}`;
}

/** Sessions of Octo 1.2 and earlier: their screen text was encrypted with a key that is gone. */
export const UNREADABLE_TEXT =
  "Le schermate di questa sessione non sono più leggibili: è stata registrata con una versione precedente di Octo.";
