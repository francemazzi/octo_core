type Capture = "idle" | "recording" | "paused" | "stopped";

type UiState = {
  capture: Capture;
  sources: Array<{ id: string; label: string; selected: boolean }>;
};

interface OctoBridge {
  getState: () => Promise<UiState>;
  start: (sourceIds: string[]) => Promise<UiState>;
  pause: () => Promise<UiState>;
  stop: () => Promise<UiState>;
  onState: (callback: (state: UiState) => void) => () => void;
}

declare global {
  interface Window {
    octo: OctoBridge;
  }
}

export {};
