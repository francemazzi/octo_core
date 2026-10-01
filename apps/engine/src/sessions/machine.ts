import { OctoError } from "../errors.js";

export type CaptureState = "idle" | "recording" | "paused" | "stopped";
export type AnalysisState = "idle" | "pending" | "running" | "awaiting_answer" | "completed";

const CAPTURE_NEXT: Record<CaptureState, CaptureState[]> = {
  idle: ["recording"],
  recording: ["paused", "stopped"],
  paused: ["recording", "stopped"],
  stopped: [],
};

const ANALYSIS_NEXT: Record<AnalysisState, AnalysisState[]> = {
  idle: ["pending", "running"],
  pending: ["running", "idle"],
  running: ["awaiting_answer", "completed", "pending"],
  awaiting_answer: ["running", "completed"],
  completed: ["pending"],
};

export function assertCaptureTransition(from: CaptureState, to: CaptureState): void {
  if (!CAPTURE_NEXT[from].includes(to)) {
    throw new OctoError("invalid_transition", `capture cannot go from ${from} to ${to}`);
  }
}

export function assertAnalysisTransition(from: AnalysisState, to: AnalysisState): void {
  if (!ANALYSIS_NEXT[from].includes(to)) {
    throw new OctoError("invalid_transition", `analysis cannot go from ${from} to ${to}`);
  }
}
