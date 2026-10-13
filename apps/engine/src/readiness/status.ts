import type { CaptureMode, PullRole, Readiness, RemoteModelStatus } from "@octo/contracts";
import { fetchOllamaTags, type OllamaTag } from "../analysis/ollama.js";
import { ocrModelState } from "../capture/ocr.js";
import { OctoError } from "../errors.js";
import { createModelPull, type ModelPull } from "./pull.js";
import { missingRequirements } from "./requirements.js";

/** Ollama on this computer, and the chat model Octo downloads when the operator asks. */
export type OllamaWiring = { base: string; chatModel: string };

/** Longer than the model probe: a daemon busy reading a screenshot still counts as running. */
const TAGS_TIMEOUT_MS = 2_000;

export type ReadinessDeps = {
  ollama: OllamaWiring | undefined;
  /** The OCR model the engine reads screenshots with; null when OCR is off. */
  ocrModel: string | null;
  /** Provider of the local slot: only an Ollama slot can be filled by a download. */
  localProvider: string | null;
  localStatus: () => Promise<{ model: string | null }>;
  remoteStatus: () => Promise<RemoteModelStatus>;
  keystore: () => boolean;
  /** Records each download: started, completed or failed. */
  audit: (detail: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
};

async function ollamaTags(deps: ReadinessDeps): Promise<OllamaTag[] | null> {
  if (!deps.ollama) return null;
  try {
    return await fetchOllamaTags(deps.ollama.base, deps.fetchImpl, TAGS_TIMEOUT_MS);
  } catch {
    // Down, refusing or too slow: the dashboard says "Ollama non risponde".
    return null;
  }
}

/** What this computer has and lacks before a recording, for the given capture mode. */
export function createReadiness(deps: ReadinessDeps) {
  const downloads: ModelPull | null = deps.ollama
    ? createModelPull({
        base: deps.ollama.base,
        models: { ocr: deps.ocrModel ?? "", chat: deps.ollama.chatModel },
        audit: deps.audit,
        fetchImpl: deps.fetchImpl,
      })
    : null;

  function pullable(): PullRole[] {
    if (!deps.ollama || !downloads) return [];
    const roles: PullRole[] = [];
    if (deps.ocrModel) roles.push("ocr");
    if (deps.localProvider === "ollama") roles.push("chat");
    return roles;
  }

  return {
    /** One download of the allowlist at a time; the role decides the model, never the caller. */
    pull(role: PullRole) {
      if (!downloads || !pullable().includes(role)) {
        throw new OctoError("pull_unavailable", `nothing to download for ${role}`);
      }
      return downloads.start(role);
    },
    async status(capture: CaptureMode): Promise<Readiness> {
      const [tags, local, remote] = await Promise.all([
        ollamaTags(deps),
        deps.localStatus(),
        deps.remoteStatus(),
      ]);
      const facts = {
        capture,
        keystore: deps.keystore(),
        ollama: { reachable: tags !== null },
        ocr: deps.ocrModel
          ? { model: deps.ocrModel, ...ocrModelState(tags ?? [], deps.ocrModel) }
          : { model: null, installed: false, local: false },
        localModel: local.model,
        remote: remote ? { provider: remote.provider, model: remote.model } : null,
      };
      const missing = missingRequirements(facts);
      return {
        ...facts,
        pullable: pullable(),
        pull: downloads?.status() ?? null,
        missing,
        ready: missing.length === 0,
      };
    },
  };
}
