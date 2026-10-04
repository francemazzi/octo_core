import { useCallback, useEffect, useState } from "react";
import { initialUiState, type UiState } from "../shared/ui-state.js";

/** The state main publishes; every window renders from it. */
export function useOctoState(): UiState {
  const [state, setState] = useState<UiState>(initialUiState);
  useEffect(() => {
    void window.octo.getState().then(setState);
    return window.octo.onState(setState);
  }, []);
  return state;
}

/** Main reports command failures in `state.error`; this only catches a broken IPC call. */
export function useAction(): {
  run: (action: () => Promise<unknown>) => void;
  error: string | null;
} {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((action: () => Promise<unknown>) => {
    setError(null);
    action().catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Operazione non riuscita.");
    });
  }, []);
  return { run, error };
}
