import type {
  ChatMessage,
  ChatMode,
  RemoteProvider,
  RemoteModelConfig,
  SessionDetail,
  SessionListItem,
  SessionQuestion,
} from "@octo/contracts";

export type Capture = "idle" | "recording" | "paused";

export type Pending = "starting" | "pausing" | "resuming" | "stopping" | null;

export type UiSource = { id: string; label: string };

/** The remote model as the dashboard sees it: never the key, at most its last characters. */
export function providerLabel(provider: RemoteProvider | null): string {
  return provider === "anthropic" ? "Claude (Anthropic)" : "OpenRouter";
}
export type UiRemote = {
  provider: RemoteProvider | null;
  workspaceId: string | null;
  model: string | null;
  source: "settings" | "env" | null;
  providers: Record<
    RemoteProvider,
    { configured: boolean; hint: string | null; model: string | null; workspaceId?: string }
  >;
  available: boolean;
  problem: string | null;
};
export type RemoteAnalysisInput = {
  sessionId: string;
  provider: RemoteProvider;
  model: string;
  workspaceId?: string;
};

/** A newer release, as the dashboard shows it: `ready` means the package is downloaded and opened. */
export type UiUpdate = {
  status: "none" | "available" | "downloading" | "ready" | "error";
  version: string | null;
  /** Download progress, 0 to 100, or null while unknown. */
  progress: number | null;
  message: string | null;
};

export type RemoteInput = RemoteModelConfig;

/** One question to the session assistant; `remote` names the confirmed destination when cloud. */
export type ChatSendInput = {
  sessionId: string;
  text: string;
  mode: ChatMode;
  remote?: Omit<RemoteAnalysisInput, "sessionId">;
};

/** Everything the dashboard and the corner mascot render; main owns it and publishes copies. */
export type UiState = {
  capture: Capture;
  pending: Pending;
  error: string | null;
  note: string;
  activeSessionId: string | null;
  startedWall: string | null;
  analyzingSessionId: string | null;
  sources: UiSource[];
  sessions: SessionListItem[];
  questions: SessionQuestion[];
  remote: UiRemote;
  update: UiUpdate;
  /** Set when the dashboard should show a session (mascot click, new session, new question). */
  focus: { sessionId: string | null; at: number } | null;
};

export const initialUiState: UiState = {
  capture: "idle",
  pending: null,
  error: null,
  note: "",
  activeSessionId: null,
  startedWall: null,
  analyzingSessionId: null,
  sources: [],
  sessions: [],
  questions: [],
  remote: {
    provider: null,
    workspaceId: null,
    model: null,
    source: null,
    providers: {
      openrouter: { configured: false, hint: null, model: null },
      anthropic: { configured: false, hint: null, model: null },
    },
    available: false,
    problem: null,
  },
  update: { status: "none", version: null, progress: null, message: null },
  focus: null,
};

export type AnswerInput = { questionId: string; episodeId: string; text: string };

/** The allowlist of IPC channels: main registers exactly these, preload exposes exactly these. */
export const OCTO_CHANNELS = [
  "octo:getState",
  "octo:start",
  "octo:pause",
  "octo:resume",
  "octo:stop",
  "octo:answer",
  "octo:defer",
  "octo:analyze",
  "octo:sessionDetail",
  "octo:openMain",
  "octo:mascotPointer",
  "octo:saveRemote",
  "octo:removeRemote",
  "octo:selectRemote",
  "octo:analyzeRemote",
  "octo:installUpdate",
  "octo:chatSend",
  "octo:chatHistory",
] as const;

export type OctoChannel = (typeof OCTO_CHANNELS)[number];

export interface OctoBridge {
  getState(): Promise<UiState>;
  start(sourceIds: string[]): Promise<UiState>;
  pause(): Promise<UiState>;
  resume(): Promise<UiState>;
  stop(): Promise<UiState>;
  answer(input: AnswerInput): Promise<UiState>;
  defer(questionId: string): Promise<UiState>;
  analyze(sessionId: string): Promise<UiState>;
  sessionDetail(sessionId: string): Promise<SessionDetail>;
  openMain(sessionId: string | null): Promise<void>;
  mascotPointer(inside: boolean): Promise<void>;
  /** Resolves with the reason the key was not saved, or null. */
  saveRemote(input: RemoteInput): Promise<string | null>;
  removeRemote(provider: RemoteProvider): Promise<string | null>;
  selectRemote(provider: RemoteProvider): Promise<string | null>;
  /** Approves the evidence of a stopped session and analyses it with the remote model. */
  analyzeRemote(input: RemoteAnalysisInput): Promise<UiState>;
  /** Downloads the new release for this computer and opens it. */
  installUpdate(): Promise<void>;
  /** Asks the session assistant; resolves with its answer once stored. */
  chatSend(input: ChatSendInput): Promise<ChatMessage>;
  chatHistory(sessionId: string): Promise<ChatMessage[]>;
  onState(callback: (state: UiState) => void): () => void;
}
