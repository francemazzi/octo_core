import type { SessionDetail as Detail, SessionListItem } from "@octo/contracts";
import { useEffect, useState } from "react";
import { QuestionsPanel } from "./QuestionsPanel.js";
import {
  dayLabel,
  episodeLabel,
  formatDuration,
  formatTimeRange,
  sessionTitle,
} from "./session-format.js";
import { useAction } from "./useOcto.js";

type Props = { item: SessionListItem; analyzing: boolean };

/** Refetched whenever the list shows a change for this session (state, activities, questions). */
function versionOf(item: SessionListItem): string {
  return [
    item.sessionId,
    item.captureState,
    item.analysisState,
    item.episodeCount,
    item.openQuestionCount,
    item.title,
  ].join("|");
}

export function SessionDetail({ item, analyzing }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const { run, error } = useAction();
  const version = versionOf(item);

  useEffect(() => {
    let current = true;
    window.octo
      .sessionDetail(item.sessionId)
      .then((loaded) => {
        if (current) setDetail(loaded);
      })
      .catch(() => {
        if (current) setDetail(null);
      });
    return () => {
      current = false;
    };
  }, [version, item.sessionId]);

  const live = item.captureState === "recording" || item.captureState === "paused";
  const episodes = detail?.session.sessionId === item.sessionId ? detail.episodes : [];
  const questions = detail?.session.sessionId === item.sessionId ? detail.questions : [];
  const canAnalyse =
    !live && !analyzing && (item.analysisState === "idle" || item.analysisState === "pending");

  return (
    <article className="detail" aria-label="Dettaglio sessione">
      <header>
        <h2>{sessionTitle(item)}</h2>
        <p className="muted">
          {dayLabel(new Date(item.startedWall), new Date())} · {formatTimeRange(item)} ·{" "}
          {formatDuration(item.durationMs)}
        </p>
      </header>
      {analyzing ? <p className="muted">Analisi in corso…</p> : null}
      {live ? (
        <p className="muted">Le attività compaiono quando chiudi la sessione con Stop.</p>
      ) : null}
      {episodes.length > 0 ? (
        <ol className="episodes">
          {episodes.map((episode) => (
            <li key={episode.episodeId}>
              <div className="episode-head">
                <strong>{episodeLabel(episode)}</strong>
                <span className="muted">{formatDuration(episode.durationMs)}</span>
              </div>
              {episode.summary ? <p>{episode.summary}</p> : null}
            </li>
          ))}
        </ol>
      ) : !live && !analyzing ? (
        <p className="muted">
          {detail?.lastRun?.outcome === "rejected" || detail?.lastRun?.outcome === "error"
            ? "L'ultima analisi non ha riconosciuto attività."
            : "Nessuna attività ancora."}
        </p>
      ) : null}
      {canAnalyse ? (
        <button type="button" onClick={() => run(() => window.octo.analyze(item.sessionId))}>
          Analizza
        </button>
      ) : null}
      {questions.length > 0 ? <QuestionsPanel questions={questions} /> : null}
      {error ? <p role="alert">{error}</p> : null}
    </article>
  );
}
