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

/**
 * Session time in the current clock epoch: latest offset minus earliest offset. Frames read by OCR
 * after a pause or stop are stored later but keep their capture offset, so the order of rows does
 * not matter.
 */
export function sessionDurationMs(db: Sql, sessionId: string, epochId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(offset_ms) AS first, MAX(offset_ms) AS last
       FROM capture_events WHERE session_id = ? AND epoch_id = ?`,
    )
    .get(sessionId, epochId) as { count: number; first: number | null; last: number | null };
  if (row.count < 2 || row.first === null || row.last === null) return 0;
  return durationFromOffsets(row.first, row.last);
}
