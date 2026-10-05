import { remoteModelConfigSchema, remoteModelStatusSchema } from "@octo/contracts";
import type { UiRemote } from "../shared/ui-state.js";
import { EngineError, type EngineRequest } from "./engine-client.js";
import type { SettingsStore } from "./settings-store.js";

const VERIFY_TIMEOUT_MS = 30_000;

const MESSAGES: Record<string, string> = {
  invalid_key: "OpenRouter ha rifiutato la chiave.",
  remote_unreachable: "OpenRouter non risponde: controlla la connessione e riprova.",
  invalid_payload: "La chiave non ha un formato valido.",
};

function explain(error: unknown): string {
  if (error instanceof EngineError) return MESSAGES[error.code] ?? error.message;
  return error instanceof Error ? error.message : "Operazione non riuscita.";
}

/** The renderer is untrusted input: only a trimmed key and an optional model name pass. */
function parseInput(payload: unknown) {
  const record = (payload ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const model = text(record.model);
  return remoteModelConfigSchema.safeParse({
    provider: "openrouter",
    apiKey: text(record.apiKey),
    ...(model ? { model } : {}),
  });
}

/**
 * The OpenRouter key set in the app: checked by the engine with OpenRouter before it is saved
 * in the keystore, handed to the engine at every start, never sent to the renderer.
 */
export function createRemoteModel(deps: {
  request: EngineRequest;
  store: SettingsStore;
  publish: (remote: UiRemote) => void;
}) {
  let available = false;

  async function refresh(): Promise<void> {
    const reply = await deps.request({ cmd: "model.status" });
    const remote = (reply.result as { remote?: unknown } | undefined)?.remote ?? null;
    available = remoteModelStatusSchema.parse(remote) !== null;
    deps.publish({ ...deps.store.summary(), available, problem: deps.store.problem() });
  }

  return {
    /** After the handshake: a saved key reaches the engine without calling OpenRouter. */
    async boot(): Promise<void> {
      const saved = deps.store.readOpenRouter();
      if (saved) {
        await deps.request({
          cmd: "model.configure",
          verify: false,
          remote: { provider: "openrouter", ...saved },
        });
      }
      await refresh();
    },
    /** Resolves with the reason the key was not saved, or null. */
    async save(payload: unknown): Promise<string | null> {
      const problem = deps.store.problem();
      if (problem) return problem;
      const parsed = parseInput(payload);
      if (!parsed.success) return MESSAGES.invalid_payload ?? null;
      try {
        await deps.request(
          { cmd: "model.configure", verify: true, remote: parsed.data },
          VERIFY_TIMEOUT_MS,
        );
        deps.store.writeOpenRouter({ apiKey: parsed.data.apiKey, model: parsed.data.model });
        return null;
      } catch (error) {
        // A key the engine took but the keystore could not save would vanish at the next start.
        if (!(error instanceof EngineError)) {
          await deps.request({ cmd: "model.configure", verify: false, remote: null });
        }
        return explain(error);
      } finally {
        await refresh();
      }
    },
    async remove(): Promise<string | null> {
      try {
        deps.store.clearOpenRouter();
        await deps.request({ cmd: "model.configure", verify: false, remote: null });
        return null;
      } catch (error) {
        return explain(error);
      } finally {
        await refresh();
      }
    },
  };
}

export type RemoteModel = ReturnType<typeof createRemoteModel>;
