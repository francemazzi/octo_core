import { MAX_ANALYSIS_BATCHES, MAX_BATCH_EVIDENCE } from "@octo/contracts/limits";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";
import { useState } from "react";
import { RemoteConsent } from "./RemoteConsent.js";
import { useAction } from "./useOcto.js";

type Props = { sessionId: string; evidenceCount: number; remote: UiRemote };

/** At most two calls per batch (one retry), within the batch limit of an analysis. */
function maxRequests(evidenceCount: number): number {
  return (
    2 * Math.min(MAX_ANALYSIS_BATCHES, Math.max(1, Math.ceil(evidenceCount / MAX_BATCH_EVIDENCE)))
  );
}

/** Confirm the exact destination before sending; a provider/model change remounts this panel. */
export function RemoteAnalysis({ sessionId, evidenceCount, remote }: Props) {
  const label = providerLabel(remote.provider);
  const [confirming, setConfirming] = useState(false);
  const { run, error } = useAction();

  if (!confirming) {
    return (
      <button type="button" disabled={evidenceCount === 0} onClick={() => setConfirming(true)}>
        Analizza con {label}
      </button>
    );
  }
  return (
    <RemoteConsent
      remote={remote}
      evidenceCount={evidenceCount}
      requestsNote={`Al massimo ${maxRequests(evidenceCount)} richieste.`}
      onConfirm={() => {
        setConfirming(false);
        run(() =>
          window.octo.analyzeRemote({
            sessionId,
            provider: remote.provider!,
            model: remote.model!,
            ...(remote.workspaceId ? { workspaceId: remote.workspaceId } : {}),
          }),
        );
      }}
      onCancel={() => setConfirming(false)}
    >
      {error ? <p role="alert">{error}</p> : null}
    </RemoteConsent>
  );
}
