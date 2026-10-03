import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";

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

/** Session time in the current clock epoch: last event offset minus first event offset. */
export function sessionDurationMs(db: Sql, sessionId: string, epochId: string): number {
  const rows = db
    .prepare(
      "SELECT offset_ms FROM capture_events WHERE session_id = ? AND epoch_id = ? ORDER BY sequence",
    )
    .all(sessionId, epochId) as Array<{ offset_ms: number }>;
  if (rows.length < 2) return 0;
  return durationFromOffsets(rows[0]?.offset_ms ?? 0, rows[rows.length - 1]?.offset_ms ?? 0);
}
