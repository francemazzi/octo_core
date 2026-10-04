import { useState } from "react";
import type { UiState } from "../shared/ui-state.js";
import { formatClock } from "./session-format.js";
import { useAction } from "./useOcto.js";

const PENDING_TEXT = {
  starting: "Avvio…",
  pausing: "Metto in pausa…",
  resuming: "Riprendo…",
  stopping: "Chiudo la sessione…",
} as const;

/** The only place with recording controls: start when idle, pause/resume and stop otherwise. */
export function ActiveSession({ state }: { state: UiState }) {
  const [selected, setSelected] = useState<string[]>([]);
  const { run, error } = useAction();
  const busy = state.pending !== null;

  return (
    <section className="active" aria-label="Sessione attiva">
      {state.capture === "idle" ? (
        <>
          <h2>Nessuna sessione attiva</h2>
          <div className="sources">
            {state.sources.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, source.id]
                        : current.filter((id) => id !== source.id),
                    )
                  }
                />
                {source.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={selected.length === 0 || busy}
            onClick={() => run(() => window.octo.start(selected))}
          >
            Avvia
          </button>
        </>
      ) : (
        <>
          <div className="status">
            <span className={`dot ${state.capture}`} aria-hidden="true" />
            <strong>{state.capture === "paused" ? "In pausa" : "In registrazione"}</strong>
            {state.startedWall ? (
              <span className="muted">dalle {formatClock(state.startedWall)}</span>
            ) : null}
          </div>
          <div className="controls">
            {state.capture === "recording" ? (
              <button type="button" disabled={busy} onClick={() => run(() => window.octo.pause())}>
                Pausa
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => run(() => window.octo.resume())}>
                Riprendi
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => run(() => window.octo.stop())}>
              Stop
            </button>
          </div>
        </>
      )}
      {state.pending ? <p className="muted">{PENDING_TEXT[state.pending]}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
