import type { PullRole, Readiness } from "@octo/contracts";
import type { ReactNode } from "react";
import { MISSING_TEXT, PULL_ERROR_TEXT } from "../shared/readiness-text.js";
import { useAction } from "./useOcto.js";

type Props = { readiness: Readiness | null; onSettings: () => void };
type Run = (action: () => Promise<unknown>) => void;

function remoteName(provider: string): string {
  if (provider === "anthropic") return "Claude (Anthropic)";
  return provider === "openrouter" ? "OpenRouter" : provider;
}

function Row({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <li className={ok ? "ok" : "missing"}>
      <span className="mark" aria-hidden="true">
        {ok ? "✓" : "!"}
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

/** Downloads one model of the allowlist; while it runs, shows its progress instead. */
function PullButton(props: { readiness: Readiness; role: PullRole; label: string; run: Run }) {
  const { readiness, role, label, run } = props;
  const pull = readiness.pull;
  const mine = pull?.role === role ? pull : null;
  if (mine?.status === "running") {
    const percent = mine.totalBytes
      ? Math.round((mine.completedBytes / mine.totalBytes) * 100)
      : null;
    return (
      <p className="pull">
        Download di {mine.model}…{" "}
        <progress aria-label={`Download di ${mine.model}`} max={100} value={percent ?? undefined} />
        {percent !== null ? ` ${percent}%` : null}
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={pull?.status === "running" || !readiness.ollama.reachable}
        onClick={() => run(() => window.octo.pullModel(role))}
      >
        {label}
      </button>
      {mine?.status === "failed" && mine.error ? (
        <p role="alert">{PULL_ERROR_TEXT[mine.error]}</p>
      ) : null}
    </>
  );
}

function rows(readiness: Readiness, run: Run, onSettings: () => void): ReactNode[] {
  const { ocr, ollama, localModel, remote } = readiness;
  const screen = readiness.capture === "screen";
  const items: ReactNode[] = [];
  if (!readiness.keystore) {
    items.push(
      <Row key="keystore" ok={false} title="Archivio sicuro">
        <p>{MISSING_TEXT.keystore}</p>
      </Row>,
    );
  }
  if (screen || readiness.pullable.includes("chat")) {
    items.push(
      <Row key="ollama" ok={ollama.reachable} title="Ollama">
        {ollama.reachable ? (
          <p>Ollama è attivo su questo computer.</p>
        ) : (
          <>
            <p>Ollama non risponde. Installalo e avvialo: Octo se ne accorge da solo.</p>
            <button type="button" onClick={() => run(() => window.octo.installOllama())}>
              Installa Ollama
            </button>
            <button type="button" onClick={() => run(() => window.octo.checkReadiness())}>
              Controlla di nuovo
            </button>
          </>
        )}
      </Row>,
    );
  }
  if (screen) {
    const ok = ocr.installed && ocr.local;
    items.push(
      <Row key="ocr" ok={ok} title="Modello di lettura">
        {ok ? (
          <p>Le schermate vengono lette su questo computer ({ocr.model}).</p>
        ) : ocr.model === null ? (
          <p>In questa installazione la lettura delle schermate è spenta.</p>
        ) : (
          <>
            <p>
              {ocr.installed
                ? "Il modello di lettura gira su ollama.com: serve la copia su questo computer."
                : MISSING_TEXT.ocr_model}
            </p>
            <PullButton
              readiness={readiness}
              role="ocr"
              label="Scarica modello di lettura"
              run={run}
            />
          </>
        )}
      </Row>,
    );
  }
  const analysisOk = localModel !== null || remote !== null;
  items.push(
    <Row key="analysis" ok={analysisOk} title="Modello di analisi">
      {localModel ? (
        <p>Analisi con il modello locale {localModel}.</p>
      ) : remote ? (
        <p>
          Analisi con {remoteName(remote.provider)}
          {remote.model ? ` (${remote.model})` : ""}.
        </p>
      ) : (
        <>
          <p>{MISSING_TEXT.analysis_model}</p>
          {readiness.pullable.includes("chat") ? (
            <PullButton
              readiness={readiness}
              role="chat"
              label="Scarica modello locale"
              run={run}
            />
          ) : null}
          <button type="button" onClick={onSettings}>
            Inserisci una chiave
          </button>
        </>
      )}
    </Row>,
  );
  return items;
}

/**
 * What this computer needs before a recording, each with the action that fixes it. Avvia stays
 * off until the list is complete; once ready it folds away.
 */
export function ReadinessChecklist({ readiness, onSettings }: Props) {
  const { run, error } = useAction();
  if (!readiness) return <p className="muted">Controllo che il computer sia pronto…</p>;
  const list = <ul className="checklist">{rows(readiness, run, onSettings)}</ul>;
  return (
    <section className="readiness" aria-label="Prima di registrare">
      {readiness.ready ? (
        <details>
          <summary>Il computer è pronto per registrare</summary>
          {list}
        </details>
      ) : (
        <>
          <h3>Prima di registrare</h3>
          {list}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
