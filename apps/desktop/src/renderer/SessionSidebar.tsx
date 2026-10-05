import type { SessionListItem } from "@octo/contracts";
import {
  formatDuration,
  formatTimeRange,
  groupSessionsByDay,
  sessionTitle,
  statusChip,
} from "./session-format.js";

type Props = {
  sessions: SessionListItem[];
  selectedId: string | null;
  analyzingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onSettings: () => void;
};

export function SessionSidebar({
  sessions,
  selectedId,
  analyzingSessionId,
  onSelect,
  onSettings,
}: Props) {
  const groups = groupSessionsByDay(sessions, new Date());
  return (
    <nav className="sidebar" aria-label="Sessioni">
      <header className="brand">
        <img src="logo_octo.png" alt="" width={32} height={32} />
        <span>Octo</span>
        <button type="button" className="settings-link" onClick={onSettings}>
          Impostazioni
        </button>
      </header>
      {groups.length === 0 ? <p className="muted">Ancora nessuna sessione.</p> : null}
      {groups.map((group) => (
        <section key={group.key} className="day">
          <h3>{group.label}</h3>
          <ul>
            {group.sessions.map((session) => {
              const title = sessionTitle(session);
              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className="row"
                    aria-label={title}
                    aria-current={session.sessionId === selectedId ? "true" : undefined}
                    onClick={() => onSelect(session.sessionId)}
                  >
                    <span className="row-title">{title}</span>
                    <span className="row-meta">
                      {formatTimeRange(session)} · {formatDuration(session.durationMs)}
                    </span>
                    <span className="chip">{statusChip(session, analyzingSessionId)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
