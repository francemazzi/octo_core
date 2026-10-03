type Capture = "idle" | "recording" | "paused" | "stopped";

type UiQuestion = { questionId: string; episodeId: string; prompt: string; status: string };

type UiState = {
  capture: Capture;
  note: string;
  sources: Array<{ id: string; label: string; selected: boolean }>;
  questions: UiQuestion[];
};

interface OctoBridge {
  getState: () => Promise<UiState>;
  start: (sourceIds: string[]) => Promise<UiState>;
  pause: () => Promise<UiState>;
  stop: () => Promise<UiState>;
  answer: (input: { questionId: string; episodeId: string; text: string }) => Promise<UiState>;
  defer: (questionId: string) => Promise<UiState>;
  onState: (callback: (state: UiState) => void) => () => void;
}

declare global {
  interface Window {
    octo: OctoBridge;
  }
}

export {};
