import { useEffect, useState } from "react";
import { ActiveSession } from "./ActiveSession.js";
import { SessionDetail } from "./SessionDetail.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { UpdateBanner } from "./UpdateBanner.js";
import { Settings } from "./Settings.js";
import { defaultSelection } from "./session-format.js";
import { useOctoState } from "./useOcto.js";

/** Sidebar of sessions by day; on the right the active session and the selected one. */
export function Dashboard() {
  const state = useOctoState();
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The session whose remote confirmation opens by itself (after Stop, no local model). */
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const focusAt = state.focus?.at;

  useEffect(() => {
    if (state.focus?.sessionId) {
      setSelected(state.focus.sessionId);
      setSettingsOpen(false);
      setConsentFor(state.focus.consent ? state.focus.sessionId : null);
    }
    // Only a new focus request moves the selection, not every state update.
  }, [focusAt]);

  const openSettings = () => {
    setSettingsOpen(true);
    setConsentFor(null);
  };

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
        onSettings={openSettings}
      />
      <main className="content">
        <UpdateBanner update={state.update} />
        <ActiveSession state={state} onSettings={openSettings} />
        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.note ? <p className="note">{state.note}</p> : null}
        {settingsOpen ? (
          <Settings
            key={state.remote.provider ?? "none"}
            remote={state.remote}
            onClose={() => setSettingsOpen(false)}
          />
        ) : item ? (
          <SessionDetail
            item={item}
            analyzing={state.analyzingSessionId === item.sessionId}
            busy={state.analyzingSessionId !== null}
            remote={state.remote}
            localModel={state.readiness?.localModel ?? null}
            autoConsent={consentFor === item.sessionId}
            onConsentSettled={() => setConsentFor(null)}
          />
        ) : (
          <p className="muted">Scegli uno schermo e avvia la prima sessione.</p>
        )}
      </main>
    </div>
  );
}
