import { useState } from "react";

export type UiQuestion = { questionId: string; episodeId: string; prompt: string; status: string };

export function QuestionsPanel({ questions }: { questions: UiQuestion[] }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(questionId: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(questionId);
    setError("");
    try {
      await action();
      setDrafts((current) => ({ ...current, [questionId]: "" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Operazione non riuscita.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="questions" aria-label="Domande">
      <h2>Domande</h2>
      {questions.map((question) => {
        const text = drafts[question.questionId] ?? "";
        return (
          <form
            key={question.questionId}
            className="question"
            onSubmit={(event) => {
              event.preventDefault();
              void act(question.questionId, () =>
                window.octo.answer({
                  questionId: question.questionId,
                  episodeId: question.episodeId,
                  text,
                }),
              );
            }}
          >
            <p>
              {question.prompt}
              {question.status === "deferred" ? " (rimandata)" : ""}
            </p>
            <textarea
              aria-label={`Risposta: ${question.prompt}`}
              value={text}
              maxLength={1000}
              rows={2}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [question.questionId]: event.target.value }))
              }
            />
            <div className="actions">
              <button type="submit" disabled={busy !== null || text.trim().length === 0}>
                Rispondi
              </button>
              {question.status === "open" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(question.questionId, () => window.octo.defer(question.questionId))
                  }
                >
                  Rimanda
                </button>
              ) : null}
            </div>
          </form>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
