import { useEffect, useState } from "react";
import { ActiveSession } from "./ActiveSession.js";
import { SessionDetail } from "./SessionDetail.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { defaultSelection } from "./session-format.js";
import { useOctoState } from "./useOcto.js";

/** Sidebar of sessions by day; on the right the active session and the selected one. */
export function Dashboard() {
  const state = useOctoState();
  const [selected, setSelected] = useState<string | null>(null);
  const focusAt = state.focus?.at;

  useEffect(() => {
    if (state.focus?.sessionId) setSelected(state.focus.sessionId);
    // Only a new focus request moves the selection, not every state update.
  }, [focusAt]);

  const selectedId =
    selected && state.sessions.some((session) => session.sessionId === selected)
      ? selected
      : defaultSelection(state.sessions, state.activeSessionId);
  const item = state.sessions.find((session) => session.sessionId === selectedId);

  return (
    <div className="dashboard">
      <SessionSidebar
        sessions={state.sessions}
        selectedId={selectedId}
        analyzingSessionId={state.analyzingSessionId}
        onSelect={setSelected}
      />
      <main className="content">
        <ActiveSession state={state} />
        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.note ? <p className="note">{state.note}</p> : null}
        {item ? (
          <SessionDetail item={item} analyzing={state.analyzingSessionId === item.sessionId} />
        ) : (
          <p className="muted">Scegli uno schermo e avvia la prima sessione.</p>
        )}
      </main>
    </div>
  );
}
