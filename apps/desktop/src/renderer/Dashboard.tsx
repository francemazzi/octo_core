import { useEffect, useState } from "react";
import { ActiveSession } from "./ActiveSession.js";
import { SessionDetail } from "./SessionDetail.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { Settings } from "./Settings.js";
import { defaultSelection } from "./session-format.js";
import { useOctoState } from "./useOcto.js";

/** Sidebar of sessions by day; on the right the active session and the selected one. */
export function Dashboard() {
  const state = useOctoState();
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focusAt = state.focus?.at;

  useEffect(() => {
    if (state.focus?.sessionId) {
      setSelected(state.focus.sessionId);
      setSettingsOpen(false);
    }
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
        onSelect={(sessionId) => {
          setSelected(sessionId);
          setSettingsOpen(false);
        }}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="content">
        <ActiveSession state={state} />
        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.note ? <p className="note">{state.note}</p> : null}
        {settingsOpen ? (
          <Settings remote={state.remote} onClose={() => setSettingsOpen(false)} />
        ) : item ? (
          <SessionDetail
            item={item}
            analyzing={state.analyzingSessionId === item.sessionId}
            busy={state.analyzingSessionId !== null}
            remoteAvailable={state.remote.available}
          />
        ) : (
          <p className="muted">Scegli uno schermo e avvia la prima sessione.</p>
        )}
      </main>
    </div>
  );
}
