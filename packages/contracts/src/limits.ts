/** Analysis limits shared by engine and desktop; no zod here, the renderer imports this file. */

/** Upper bound of one model call (Ollama or OpenRouter). */
export const MODEL_CALL_TIMEOUT_MS = 120_000;
/** Evidence per model call: long sessions are analysed in batches of this size. */
export const MAX_BATCH_EVIDENCE = 200;
/** Batches per analysis; evidence beyond them is not sent and the run is marked partial. */
export const MAX_ANALYSIS_BATCHES = 10;
/** Whole analysis: every batch may retry once, plus room to read the last screenshots. */
export const ANALYSIS_TIMEOUT_MS = (MAX_ANALYSIS_BATCHES * 2 + 1) * MODEL_CALL_TIMEOUT_MS;

/** One question to the session assistant, as the operator types it. */
export const MAX_CHAT_TEXT_CHARS = 2_000;
/** One answer of the assistant, after cleaning. */
export const MAX_CHAT_ANSWER_CHARS = 2_000;
export const MAX_CHAT_CITATIONS = 20;
/** Earlier turns of the conversation sent back to the model with a new question. */
export const MAX_CHAT_HISTORY_TURNS = 10;
/** One assistant reply: a single model call plus room to read the screen text. */
export const CHAT_TIMEOUT_MS = MODEL_CALL_TIMEOUT_MS + 30_000;
