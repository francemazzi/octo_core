import { questionListResultSchema, type SessionQuestion } from "@octo/contracts";
import type { AnswerInput } from "../shared/ui-state.js";
import type { EngineRequest } from "./engine-client.js";

const MAX_ID_CHARS = 100;
const MAX_TEXT_CHARS = 1_000;

/** The renderer is untrusted input: ids are short non-empty strings or the call is refused. */
export function parseId(value: unknown, what = "domanda"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARS) {
    throw new Error(`${what} non valida`);
  }
  return value;
}

export function parseAnswer(payload: unknown): AnswerInput {
  const record = (payload ?? {}) as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (text.length === 0 || text.length > MAX_TEXT_CHARS) throw new Error("risposta non valida");
  return { questionId: parseId(record.questionId), episodeId: parseId(record.episodeId), text };
}

export async function fetchQuestions(request: EngineRequest): Promise<SessionQuestion[]> {
  const reply = await request({ cmd: "question.list" });
  return questionListResultSchema.parse(reply.result).questions;
}

export function answerNote(result: unknown): string {
  const answered = result as { status?: string; analysis?: string | null };
  if (answered.status !== "accepted") return "La risposta non corrisponde alla domanda.";
  return answered.analysis === "completed"
    ? "Grazie, analisi completata."
    : "Grazie, risposta salvata.";
}
