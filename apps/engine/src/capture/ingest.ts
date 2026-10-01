import { randomUUID } from "node:crypto";
import { maskText, minimizeText } from "@octo/capture-adapter";
import { sha256 } from "../crypto/aes.js";
import type { MediaStore } from "../storage/media-store.js";
import type { Sql } from "../storage/db.js";

export type IngestResult = { stored: boolean; reason: string };

export function ingestFrame(
  db: Sql,
  media: MediaStore,
  input: {
    sessionId: string;
    captureState: string;
    authorized: Set<string>;
    frameId: string;
    sourceId: string;
    offsetMs: number;
    payload: string;
    epochId: string;
    wall: string;
  },
): IngestResult {
  if (input.captureState !== "recording") return { stored: false, reason: "not_recording" };
  if (!input.authorized.has(input.sourceId)) return { stored: false, reason: "unauthorized" };
  const masked = maskText(input.payload);
  const minimized = minimizeText(masked.text);
  const hash = sha256(minimized);
  const duplicate = db
    .prepare("SELECT id FROM assets WHERE session_id = ? AND hash = ? AND state = 'valid'")
    .get(input.sessionId, hash) as { id: string } | undefined;
  if (duplicate) return { stored: false, reason: "duplicate" };

  const begun = media.begin(input.sessionId, Buffer.from(minimized));
  media.commit(begun.assetId);
  db.prepare(
    `INSERT INTO evidence (
      id, session_id, source_id, start_ms, end_ms, asset_id, content_hash, masks_json, availability, review_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid', 'pending')`,
  ).run(
    `ev-${input.frameId}`,
    input.sessionId,
    input.sourceId,
    input.offsetMs,
    input.offsetMs,
    begun.assetId,
    hash,
    JSON.stringify(masked.masks),
  );
  db.prepare(
    `INSERT INTO capture_events (id, session_id, wall_time, offset_ms, epoch_id, sequence, kind, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, 'frame', ?)`,
  ).run(
    randomUUID(),
    input.sessionId,
    input.wall,
    input.offsetMs,
    input.epochId,
    nextSequence(db, input.sessionId),
    JSON.stringify({ frameId: input.frameId }),
  );
  return { stored: true, reason: "stored" };
}

export function nextSequence(db: Sql, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM capture_events WHERE session_id = ?",
    )
    .get(sessionId) as { sequence: number };
  return row.sequence + 1;
}
