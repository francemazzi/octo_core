import { useState } from "react";
import { PAUSE_TEXT } from "../shared/readiness-text.js";
import type { UiState } from "../shared/ui-state.js";
import { ReadinessChecklist } from "./ReadinessChecklist.js";
import { formatClock } from "./session-format.js";
import { useAction } from "./useOcto.js";

const PENDING_TEXT = {
  starting: "Avvio…",
  pausing: "Metto in pausa…",
  resuming: "Riprendo…",
  stopping: "Chiudo la sessione…",
} as const;

type Props = { state: UiState; onSettings: () => void };

/**
 * The only place with recording controls: start when idle, pause/resume and stop otherwise.
 * Avvia and Riprendi wait for the list «Prima di registrare»: no recording Octo cannot read.
 */
export function ActiveSession({ state, onSettings }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const { run, error } = useAction();
  const busy = state.pending !== null;
  const ready = state.readiness?.ready === true;

  return (
    <section className="active" aria-label="Sessione attiva">
      {state.capture === "idle" ? (
        <>
          <h2>Nessuna sessione attiva</h2>
          <ReadinessChecklist readiness={state.readiness} onSettings={onSettings} />
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
            disabled={selected.length === 0 || busy || !ready}
            onClick={() => run(() => window.octo.start(selected))}
          >
            Avvia
          </button>
          {!ready ? (
            <p className="muted">
              Avvia si attiva quando la lista «Prima di registrare» è completa.
            </p>
          ) : null}
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
          {state.capture === "paused" && state.pauseCause ? (
            <p className="pause-cause" role="alert">
              {PAUSE_TEXT[state.pauseCause]}
            </p>
          ) : null}
          {state.capture === "paused" && !ready ? (
            <ReadinessChecklist readiness={state.readiness} onSettings={onSettings} />
          ) : null}
          <div className="controls">
            {state.capture === "recording" ? (
              <button type="button" disabled={busy} onClick={() => run(() => window.octo.pause())}>
                Pausa
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !ready}
                onClick={() => run(() => window.octo.resume())}
              >
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
