import type { RemoteProvider } from "@octo/contracts";
import type { UiRemote } from "../shared/ui-state.js";

export type RemoteTarget = { provider: RemoteProvider; model: string; workspaceId?: string };

/** What the operator confirmed must still be the configured destination before anything is sent. */
export function assertRemoteUnchanged(remote: UiRemote, target: RemoteTarget): void {
  if (
    !remote.available ||
    target.provider !== remote.provider ||
    target.model !== remote.model ||
    (target.workspaceId ?? null) !== remote.workspaceId
  ) {
    throw new Error("Il provider o il modello sono cambiati. Conferma nuovamente l’invio.");
  }
}
