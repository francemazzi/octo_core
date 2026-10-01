import { OctoError } from "../errors.js";

export type ClockReading = { epochId: string; offsetMs: number; wall: string };

export function offsetMs(originMs: number, monotonicMs: number): number {
  return monotonicMs - originMs;
}

export function durationFromOffsets(startOffsetMs: number, endOffsetMs: number): number {
  const duration = endOffsetMs - startOffsetMs;
  if (duration < 0) {
    throw new OctoError("negative_duration", "session offsets decreased inside one epoch");
  }
  return duration;
}

export function assertSingleEpoch(epochIds: string[]): void {
  const unique = new Set(epochIds);
  if (unique.size > 1) {
    throw new OctoError("mixed_epochs", "cannot subtract offsets from different process epochs");
  }
}
