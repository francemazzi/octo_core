import type { EngineRequest } from "./engine-client.js";

export type UiQuestion = { questionId: string; episodeId: string; prompt: string; status: string };

export type AnswerInput = { questionId: string; episodeId: string; text: string };

const MAX_ID_CHARS = 100;
const MAX_TEXT_CHARS = 1_000;

function shortId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARS) {
    throw new Error("domanda non valida");
  }
  return value;
}

/** The renderer is untrusted input: only well-formed answers reach the engine. */
export function parseAnswer(payload: unknown): AnswerInput {
  const record = (payload ?? {}) as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (text.length === 0 || text.length > MAX_TEXT_CHARS) throw new Error("risposta non valida");
  return { questionId: shortId(record.questionId), episodeId: shortId(record.episodeId), text };
}

export function parseQuestionId(payload: unknown): string {
  return shortId(payload);
}

export async function fetchQuestions(request: EngineRequest): Promise<UiQuestion[]> {
  const reply = await request({ cmd: "question.list" });
  const rows = (reply.result as { questions?: UiQuestion[] } | undefined)?.questions ?? [];
  return rows.map((row) => ({
    questionId: row.questionId,
    episodeId: row.episodeId,
    prompt: row.prompt,
    status: row.status,
  }));
}

export function answerNote(result: unknown): string {
  const answered = result as { status?: string; analysis?: string | null };
  if (answered.status !== "accepted") return "La risposta non corrisponde alla domanda.";
  return answered.analysis === "completed"
    ? "Grazie, analisi completata."
    : "Grazie, risposta salvata.";
}
