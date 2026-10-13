import type { UiRemote } from "../shared/ui-state.js";
import type { SessionDetail as Detail, SessionListItem } from "@octo/contracts";
import { useEffect, useState } from "react";
import { UNREADABLE_TEXT } from "../shared/readiness-text.js";
import { ChatPanel } from "./ChatPanel.js";
import { QuestionsPanel } from "./QuestionsPanel.js";
import { RemoteAnalysis } from "./RemoteAnalysis.js";
import {
  dayLabel,
  episodeLabel,
  formatDuration,
  formatTimeRange,
  sessionTitle,
} from "./session-format.js";
import { useAction } from "./useOcto.js";

type Props = {
  item: SessionListItem;
  analyzing: boolean;
  /** Another session is being analysed: one analysis at a time. */
  busy: boolean;
  remote: UiRemote;
  /** The local model that can analyse, or null: then only the remote one is offered. */
  localModel: string | null;
  /** Open the remote confirmation at once (after Stop, when no local model exists). */
  autoConsent: boolean;
  onConsentSettled: () => void;
};

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

export function SessionDetail(props: Props) {
  const { item, analyzing, busy, remote, localModel, autoConsent, onConsentSettled } = props;
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
    localModel !== null &&
    !live &&
    !busy &&
    (item.analysisState === "idle" || item.analysisState === "pending");
  const loaded = detail?.session.sessionId === item.sessionId ? detail : null;
  // A new recipient remounts the confirmations: consent never carries over to another one.
  const recipient = `${item.sessionId}:${remote.provider}:${remote.model}:${remote.workspaceId}`;

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
              {episode.operatorNote ? (
                <p className="statement">Dichiarazione dell'operatore: {episode.operatorNote}</p>
              ) : null}
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
      {remote.available && !live && !busy && loaded ? (
        <RemoteAnalysis
          key={`remote:${recipient}`}
          remote={remote}
          sessionId={item.sessionId}
          evidenceCount={loaded.evidenceCount}
          autoOpen={autoConsent}
          onSettled={onConsentSettled}
        />
      ) : null}
      {loaded?.lastRun?.error === "unreadable_evidence" ? (
        <p className="muted">{UNREADABLE_TEXT}</p>
      ) : loaded?.lastRun?.partial ? (
        <p className="muted">Analisi parziale: il modello non ha letto tutte le schermate.</p>
      ) : null}
      {questions.length > 0 ? <QuestionsPanel questions={questions} /> : null}
      {!live && loaded ? (
        <ChatPanel
          key={`chat:${recipient}`}
          sessionId={item.sessionId}
          evidenceCount={loaded.evidenceCount}
          remote={remote}
          localModel={localModel}
          busy={busy || analyzing}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </article>
  );
}
