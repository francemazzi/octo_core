import {
  remoteModelConfigSchema,
  remoteModelStatusSchema,
  remoteProviderSchema,
  type RemoteProvider,
} from "@octo/contracts";
import { providerLabel, type UiRemote } from "../shared/ui-state.js";
import { EngineError, type EngineRequest } from "./engine-client.js";
import type { SettingsStore } from "./settings-store.js";

function explain(error: unknown, provider: RemoteProvider): string {
  const name = providerLabel(provider);
  if (error instanceof EngineError) {
    if (error.code === "workspace_required")
      return "Questa chiave richiede un workspace Anthropic. Inserisci l’ID workspace e riprova.";
    if (error.code === "invalid_key") return `${name} ha rifiutato la chiave.`;
    if (error.code === "remote_unreachable")
      return `${name} non risponde: controlla la connessione e riprova.`;
  }
  return "Configurazione non riuscita. La configurazione precedente è stata mantenuta.";
}

/** Serializes settings changes and prevents a change during a consented analysis. */
export function createRemoteModel(deps: {
  request: EngineRequest;
  store: SettingsStore;
  publish: (remote: UiRemote) => void;
  analyzing?: () => boolean;
}) {
  let changing = false;
  let active: RemoteProvider | null = null;
  async function refresh(): Promise<void> {
    const reply = await deps.request({ cmd: "model.status" });
    const remote = remoteModelStatusSchema.parse(
      (reply.result as { remote?: unknown })?.remote ?? null,
    );
    active = deps.store.active() ?? (remote ? remoteProviderSchema.parse(remote.provider) : null);
    deps.publish({
      provider: active,
      model: remote?.model ?? null,
      source: remote?.source ?? null,
      workspaceId: remote?.workspaceId ?? null,
      available: remote !== null,
      problem: deps.store.problem(),
      providers: {
        openrouter: deps.store.summary("openrouter"),
        anthropic: deps.store.summary("anthropic"),
      },
    });
  }
  async function configure(provider: RemoteProvider | null): Promise<void> {
    const saved = provider ? deps.store.credential(provider) : null;
    await deps.request({
      cmd: "model.configure",
      verify: false,
      remote: saved && provider ? { provider, ...saved } : null,
      ...(provider ? { environmentProvider: provider } : {}),
    });
  }
  async function change(
    provider: RemoteProvider,
    action: () => Promise<void>,
  ): Promise<string | null> {
    if (changing || deps.analyzing?.()) return "Attendi il termine dell'operazione in corso.";
    const before = deps.store.snapshot();
    changing = true;
    const previous = active;
    try {
      await action();
      return null;
    } catch (error) {
      try {
        deps.store.restore(before);
        await configure(previous);
      } catch {
        return "Configurazione non riuscita. Riavvia Octo per ripristinare le impostazioni salvate.";
      }
      return explain(error, provider);
    } finally {
      try {
        await refresh();
      } finally {
        changing = false;
      }
    }
  }
  return {
    async boot(): Promise<void> {
      await configure(deps.store.active());
      await refresh();
    },
    save(payload: unknown): Promise<string | null> {
      const parsed = remoteModelConfigSchema.safeParse(payload);
      if (!parsed.success)
        return Promise.resolve("La chiave o il modello non hanno un formato valido.");
      const config = parsed.data;
      return change(config.provider, async () => {
        if (deps.store.problem()) throw new Error("Keystore unavailable");
        await deps.request(
          { cmd: "model.configure", remote: config, verify: true, verifyOnly: true },
          30_000,
        );
        // Verify without switching, persist atomically, then refresh the active adapter if necessary.
        deps.store.save(config.provider, config);
        if (active === config.provider) {
          deps.store.select(active);
          await configure(active);
        }
      });
    },
    select(payload: unknown): Promise<string | null> {
      const parsed = remoteProviderSchema.safeParse(payload);
      if (!parsed.success) return Promise.resolve("Provider non valido.");
      return change(parsed.data, async () => {
        await configure(parsed.data);
        deps.store.select(parsed.data);
      });
    },
    remove(payload: unknown): Promise<string | null> {
      const parsed = remoteProviderSchema.safeParse(payload);
      if (!parsed.success) return Promise.resolve("Provider non valido.");
      return change(parsed.data, async () => {
        deps.store.remove(parsed.data);
        if (active === parsed.data) await configure(active);
      });
    },
    busy: () => changing,
  };
}
export type RemoteModel = ReturnType<typeof createRemoteModel>;
