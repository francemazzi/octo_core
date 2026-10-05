import { randomUUID } from "node:crypto";
import type { ModelOutput } from "@octo/contracts";
import type { TimelineFrame } from "../domain/frame-timeline.js";
import { summarizeAssignedTime, type Stretch } from "../domain/time.js";
import { OctoError } from "../errors.js";
import { assertNoPrimaryOverlap } from "../review/service.js";
import type { Sql } from "../storage/db.js";
import { OPEN_QUESTION_SQL } from "./questions.js";

export type EpisodeWrite = {
  sessionId: string;
  output: ModelOutput;
  stretches: Stretch[];
  authorized: ReadonlySet<string>;
  origin: string;
  wallTime: string;
};

/** Frames and repeats of valid evidence in the current clock epoch, in capture order. */
export function loadFrames(db: Sql, sessionId: string, epochId: string): TimelineFrame[] {
  const sources = new Map(
    (
      db
        .prepare(
          "SELECT id, source_id FROM evidence WHERE session_id = ? AND availability = 'valid'",
        )
        .all(sessionId) as Array<{ id: string; source_id: string }>
    ).map((row) => [row.id, row.source_id]),
  );
  const events = db
    .prepare(
      `SELECT offset_ms, kind, detail_json FROM capture_events
       WHERE session_id = ? AND epoch_id = ? AND kind IN ('frame', 'frame_repeat')
       ORDER BY sequence`,
    )
    .all(sessionId, epochId) as Array<{ offset_ms: number; kind: string; detail_json: string }>;
  return events.flatMap((event) => {
    const detail = JSON.parse(event.detail_json) as {
      frameId?: string;
      evidenceId?: string;
      sourceId?: string;
    };
    const evidenceId = detail.evidenceId ?? (detail.frameId ? `ev-${detail.frameId}` : undefined);
    if (!evidenceId || !sources.has(evidenceId)) return [];
    const sourceId = event.kind === "frame_repeat" ? detail.sourceId : sources.get(evidenceId);
    if (!sourceId) return [];
    return [{ evidenceId, sourceId, startMs: event.offset_ms }];
  });
}

/** A person confirmed or edited an activity of the session: no analysis may replace it. */
export function hasReviewedEpisodes(db: Sql, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS reviewed FROM episodes e WHERE e.session_id = ? AND (
         e.review_state = 'confirmed'
         OR EXISTS (SELECT 1 FROM episode_revisions r WHERE r.episode_id = e.id)
       ) LIMIT 1`,
    )
    .get(sessionId);
  return row !== undefined;
}

/**
 * Replaces the proposed episodes of the session in one transaction: a new analysis (another
 * model, a cloud run, evidence revoked) supersedes the open questions about the old ones.
 * Episode time is the union of its intervals.
 */
export function writeEpisodes(db: Sql, input: EpisodeWrite): number {
  const proposed = new Map(input.output.episodes.map((episode) => [episode.episodeId, episode]));
  const stretches = input.stretches.filter(
    (stretch) => stretch.episodeId === null || proposed.has(stretch.episodeId),
  );
  const summary = summarizeAssignedTime(stretches, input.authorized);
  const insertEpisode = db.prepare(
    `INSERT INTO episodes (
      id, session_id, activity_type, case_id, objective, review_state, duration_ms, label, summary
    ) VALUES (?, ?, ?, NULL, ?, 'proposed', ?, ?, ?)`,
  );
  const insertInterval = db.prepare(
    `INSERT INTO episode_intervals (
      id, episode_id, session_id, source_id, start_ms, end_ms, assignment, origin
    ) VALUES (?, ?, ?, ?, ?, ?, 'primary', ?)`,
  );

  db.exec("BEGIN");
  try {
    if (hasReviewedEpisodes(db, input.sessionId)) {
      throw new OctoError("reviewed_session", input.sessionId);
    }
    const replaced = db
      .prepare("DELETE FROM episodes WHERE session_id = ?")
      .run(input.sessionId).changes;
    const superseded = db
      .prepare(
        `UPDATE questions SET status = 'superseded' WHERE session_id = ? AND ${OPEN_QUESTION_SQL}`,
      )
      .run(input.sessionId).changes;
    for (const [episodeId, durationMs] of Object.entries(summary.byEpisodeMs)) {
      const episode = proposed.get(episodeId);
      insertEpisode.run(
        episodeId,
        input.sessionId,
        episode?.activityType ?? "activity",
        `Attività ${episodeId}`,
        durationMs,
        episode?.label ?? null,
        episode?.summary ?? null,
      );
      for (const stretch of stretches) {
        if (stretch.episodeId !== episodeId || stretch.assignment !== "primary") continue;
        if (stretch.kind === "declared_wait" || stretch.kind === "unknown") continue;
        for (const interval of stretch.intervals) {
          if (!input.authorized.has(interval.sourceId)) continue;
          if (interval.endMs <= interval.startMs) continue;
          insertInterval.run(
            randomUUID(),
            episodeId,
            input.sessionId,
            interval.sourceId,
            interval.startMs,
            interval.endMs,
            input.origin,
          );
        }
      }
    }
    db.prepare(
      `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
       VALUES (?, ?, ?, 'time_summary', ?)`,
    ).run(randomUUID(), input.sessionId, input.wallTime, JSON.stringify(summary));
    if (replaced > 0) {
      db.prepare(
        `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
         VALUES (?, ?, ?, 'episodes_replaced', ?)`,
      ).run(
        randomUUID(),
        input.sessionId,
        input.wallTime,
        JSON.stringify({ replaced, superseded, origin: input.origin }),
      );
    }
    const title = input.output.title ?? longestLabel(input.output, summary.byEpisodeMs);
    db.prepare("UPDATE sessions SET title = COALESCE(?, title) WHERE id = ?").run(
      title ?? null,
      input.sessionId,
    );
    assertNoPrimaryOverlap(db, input.sessionId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return Object.keys(summary.byEpisodeMs).length;
}

/** Without a model title, the session is named after its longest labelled activity. */
function longestLabel(
  output: ModelOutput,
  byEpisodeMs: Record<string, number>,
): string | undefined {
  return output.episodes
    .filter((episode) => episode.label)
    .sort((a, b) => (byEpisodeMs[b.episodeId] ?? 0) - (byEpisodeMs[a.episodeId] ?? 0))[0]?.label;
}
