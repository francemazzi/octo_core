import { useAction, useOctoState } from "./useOcto.js";

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="2" width="3.5" height="12" rx="1" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  );
}

/**
 * Only the octopus in the screen corner: a dot for recording or pause, a badge for questions,
 * Pausa/Riprendi and Stop on hover. A click on the octopus opens Octo.
 */
export function Mascot() {
  const state = useOctoState();
  const { run } = useAction();
  const waiting = state.questions.length;
  const target = state.questions[0]?.sessionId ?? state.activeSessionId;
  const busy = state.pending !== null;

  return (
    <div
      className="dock"
      onMouseEnter={() => void window.octo.mascotPointer(true)}
      onMouseLeave={() => void window.octo.mascotPointer(false)}
    >
      {state.capture !== "idle" ? (
        <div className="controls">
          {state.capture === "recording" ? (
            <button
              type="button"
              aria-label="Pausa"
              disabled={busy}
              onClick={() => run(() => window.octo.pause())}
            >
              <PauseIcon />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Riprendi"
              disabled={busy}
              onClick={() => run(() => window.octo.resume())}
            >
              <PlayIcon />
            </button>
          )}
          <button
            type="button"
            aria-label="Stop"
            disabled={busy}
            onClick={() => run(() => window.octo.stop())}
          >
            <StopIcon />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="logo"
        aria-label="Apri Octo"
        onClick={() => run(() => window.octo.openMain(target))}
      >
        <img src="logo_octo.png" alt="" draggable={false} />
        {state.capture !== "idle" ? (
          <span className={`dot ${state.capture}`} aria-hidden="true" />
        ) : null}
        {waiting > 0 ? (
          <span
            className="badge"
            role="status"
            aria-label={`${waiting} ${waiting === 1 ? "domanda" : "domande"} in attesa`}
          >
            {waiting}
          </span>
        ) : null}
      </button>
    </div>
  );
}
