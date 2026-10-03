import { useEffect, useState } from "react";
import { QuestionsPanel, type UiQuestion } from "./QuestionsPanel.js";

type Capture = "idle" | "recording" | "paused" | "stopped";

type UiState = {
  capture: Capture;
  note: string;
  sources: Array<{ id: string; label: string; selected: boolean }>;
  questions: UiQuestion[];
};

const initial: UiState = {
  capture: "idle",
  note: "",
  questions: [],
  sources: [
    { id: "mon-1", label: "Schermo 1", selected: false },
    { id: "mon-2", label: "Schermo 2", selected: false },
  ],
};

export function App() {
  const [state, setState] = useState<UiState>(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const view = new URLSearchParams(window.location.search).get("view");

  useEffect(() => {
    void window.octo.getState().then(setState);
    return window.octo.onState(setState);
  }, []);

  const recording = state.capture === "recording" || state.capture === "paused";

  return (
    <main className={view === "mascot" ? "mascot" : "dashboard"}>
      <img src="logo_octo.png" alt="Octo" width={96} height={96} />
      {view !== "mascot" && state.capture === "idle" ? (
        <>
          <p>Scegli lo schermo, poi avvia.</p>
          {state.sources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={selected.includes(source.id)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, source.id]
                      : current.filter((id) => id !== source.id),
                  );
                }}
              />
              {source.label}
            </label>
          ))}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => void window.octo.start(selected)}
          >
            Avvia
          </button>
        </>
      ) : null}
      {recording ? (
        <>
          <p>{state.capture === "paused" ? "In pausa" : "In registrazione"}</p>
          {state.capture === "recording" ? (
            <button type="button" onClick={() => void window.octo.pause()}>
              Pausa
            </button>
          ) : null}
          <button type="button" onClick={() => void window.octo.stop()}>
            Stop
          </button>
        </>
      ) : null}
      {view !== "mascot" && state.note ? <p>{state.note}</p> : null}
      {view !== "mascot" && state.questions.length > 0 ? (
        <QuestionsPanel questions={state.questions} />
      ) : null}
    </main>
  );
}
