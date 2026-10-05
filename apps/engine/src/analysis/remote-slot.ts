import type { RemoteModelConfig, RemoteModelStatus } from "@octo/contracts";
import { OctoError } from "../errors.js";
import type { AnalysisProfile, ModelAdapter } from "./model-adapter.js";

/** How the engine builds and checks a remote model from a key set in the app. */
export type RemoteModels = {
  create(config: RemoteModelConfig): ModelAdapter;
  /** Asks the provider whether the key works; sends no evidence. */
  verify(config: RemoteModelConfig): Promise<void>;
};

export type RemoteConfigured = {
  provider: string;
  model: string | null;
  source: "settings" | "env";
  verified: boolean;
};

/**
 * The remote slot of the analysis profile, swapped in place when the operator saves or removes
 * a key. Removing it brings back the model configured at start (`OPENROUTER_API_KEY`), if any.
 * An analysis already running keeps the adapter it started with.
 */
export function createRemoteSlot(deps: {
  profile: AnalysisProfile;
  models?: RemoteModels;
  audit: (detail: RemoteConfigured | { provider: null }) => void;
}) {
  const atStart = deps.profile.models.remote;
  let source: "settings" | "env" = "env";

  async function status(): Promise<RemoteModelStatus> {
    const adapter = deps.profile.models.remote;
    if (!adapter) return null;
    const { model } = await adapter.status();
    return { provider: adapter.provider, model, source };
  }

  return {
    status,
    async configure(input: {
      remote: RemoteModelConfig | null;
      verify: boolean;
    }): Promise<RemoteModelStatus> {
      if (!input.remote) {
        source = "env";
        if (atStart) deps.profile.models.remote = atStart;
        else delete deps.profile.models.remote;
        deps.audit({ provider: null });
        return status();
      }
      if (!deps.models) {
        throw new OctoError("remote_unavailable", "this engine has no remote model");
      }
      if (input.verify) await deps.models.verify(input.remote);
      const adapter = deps.models.create(input.remote);
      deps.profile.models.remote = adapter;
      source = "settings";
      const current = await status();
      deps.audit({
        provider: adapter.provider,
        model: current?.model ?? null,
        source,
        verified: input.verify,
      });
      return current;
    },
  };
}
