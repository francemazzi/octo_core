import type { SessionEpisode, SessionListItem } from "@octo/contracts";

export type DayGroup = { key: string; label: string; sessions: SessionListItem[] };

const MINUTE_MS = 60_000;

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Oggi", "Ieri", then "Venerdì 3 ottobre" (with the year when it is not this year). */
export function dayLabel(date: Date, now: Date): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return "Oggi";
  if (dayKey(date) === dayKey(yesterday)) return "Ieri";
  const format = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return capitalize(format.format(date));
}

/** Sessions arrive newest first; groups keep that order, one per local calendar day. */
export function groupSessionsByDay(sessions: SessionListItem[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const session of sessions) {
    const started = new Date(session.startedWall);
    const key = dayKey(started);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.sessions.push(session);
    else groups.push({ key, label: dayLabel(started, now), sessions: [session] });
  }
  return groups;
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) return "meno di 1 min";
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function formatTimeRange(session: SessionListItem): string {
  const end = session.endedWall ? formatClock(session.endedWall) : "in corso";
  return `${formatClock(session.startedWall)}–${end}`;
}

export function sessionTitle(session: SessionListItem): string {
  return session.title ?? `Sessione delle ${formatClock(session.startedWall)}`;
}

/** The model's Italian label, else the activity type made readable ("order_entry" → "Order entry"). */
export function episodeLabel(episode: SessionEpisode): string {
  return episode.label ?? capitalize(episode.activityType.replaceAll("_", " "));
}

/** Words that never clash with the buttons ("Pausa", "Stop", "Avvia"). */
export function statusChip(session: SessionListItem, analyzingSessionId: string | null): string {
  if (session.captureState === "recording") return "in corso";
  if (session.captureState === "paused") return "sospesa";
  if (session.sessionId === analyzingSessionId || session.analysisState === "running") {
    return "analisi…";
  }
  if (session.openQuestionCount > 0) return "domanda";
  if (session.episodeCount > 0) return "pronta";
  return "da analizzare";
}

/** The active session, else the newest one with a question, else the newest one. */
export function defaultSelection(
  sessions: SessionListItem[],
  activeSessionId: string | null,
): string | null {
  return (
    activeSessionId ??
    sessions.find((session) => session.openQuestionCount > 0)?.sessionId ??
    sessions[0]?.sessionId ??
    null
  );
}
