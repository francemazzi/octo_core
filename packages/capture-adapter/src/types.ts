export type CaptureFrame = {
  id: string;
  sourceId: string;
  offsetMs: number;
  payload: string;
};

export type CaptureGapKind = "stream_terminated" | "pause" | "backpressure";

export type CaptureGap = {
  kind: CaptureGapKind;
  offsetMs: number;
};

export interface CaptureAdapter {
  readonly name: string;
}

export interface AppContextAdapter {
  currentApp(): Promise<{ name: string; title: string } | null>;
}

export class NoopAppContextAdapter implements AppContextAdapter {
  async currentApp(): Promise<null> {
    return null;
  }
}

export type DesktopSource = {
  id: string;
  name: string;
  kind: "monitor" | "window";
};

export interface DesktopSourcePort {
  listSources(): Promise<DesktopSource[]>;
}
