import type { SessionDetail, SessionListItem, SessionQuestion } from "@octo/contracts";

export type Capture = "idle" | "recording" | "paused";

export type Pending = "starting" | "pausing" | "resuming" | "stopping" | null;

export type UiSource = { id: string; label: string };

/** The remote model as the dashboard sees it: never the key, at most its last characters. */
export type UiRemote = {
  /** A key is saved in the app settings. */
  configured: boolean;
  hint: string | null;
  model: string | null;
  /** The engine has a remote model, from the settings or from its environment. */
  available: boolean;
  /** Why a key cannot be saved on this computer, or null. */
  problem: string | null;
};

export type OpenRouterInput = { apiKey: string; model?: string };

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
  remote: { configured: false, hint: null, model: null, available: false, problem: null },
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
  "octo:saveOpenRouter",
  "octo:removeOpenRouter",
  "octo:analyzeRemote",
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
  saveOpenRouter(input: OpenRouterInput): Promise<string | null>;
  removeOpenRouter(): Promise<string | null>;
  /** Approves the evidence of a stopped session and analyses it with the remote model. */
  analyzeRemote(sessionId: string): Promise<UiState>;
  onState(callback: (state: UiState) => void): () => void;
}
