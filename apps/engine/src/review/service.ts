import { randomUUID } from "node:crypto";
import { OctoError } from "../errors.js";
import type { Sql } from "../storage/db.js";
import { totalDurationMs } from "../domain/time.js";

type IntervalRow = {
  id: string;
  episode_id: string;
  session_id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  assignment: string;
};

export function assertNoPrimaryOverlap(db: Sql, sessionId: string): void {
  const rows = db
    .prepare(
      `SELECT * FROM episode_intervals WHERE session_id = ? AND assignment = 'primary' ORDER BY source_id, start_ms`,
    )
    .all(sessionId) as unknown as IntervalRow[];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!previous || !current) continue;
    if (previous.source_id === current.source_id && current.start_ms < previous.end_ms) {
      throw new OctoError("primary_overlap", `${previous.id} overlaps ${current.id}`);
    }
  }
}

export function confirmEpisode(db: Sql, episodeId: string): void {
  const row = db.prepare("SELECT id, session_id FROM episodes WHERE id = ?").get(episodeId) as
    { id: string; session_id: string } | undefined;
  if (!row) throw new OctoError("missing_episode", episodeId);
  db.prepare("UPDATE episodes SET review_state = 'confirmed' WHERE id = ?").run(episodeId);
  revise(db, episodeId, "confirm", {});
}

export function splitEpisode(db: Sql, episodeId: string, atMs: number): string {
  const episode = mustEpisode(db, episodeId);
  const newId = `${episodeId}-b`;
  db.prepare(
    `INSERT INTO episodes (
      id, session_id, activity_type, case_id, objective, review_state, duration_ms, label, summary
    ) VALUES (?, ?, ?, NULL, ?, 'proposed', 0, ?, ?)`,
  ).run(
    newId,
    episode.session_id,
    episode.activity_type,
    episode.objective,
    episode.label,
    episode.summary,
  );
  const intervals = db
    .prepare("SELECT * FROM episode_intervals WHERE episode_id = ?")
    .all(episodeId) as unknown as IntervalRow[];
  for (const interval of intervals) {
    if (interval.end_ms <= atMs || interval.start_ms >= atMs) {
      if (interval.start_ms >= atMs) {
        db.prepare("UPDATE episode_intervals SET episode_id = ? WHERE id = ?").run(
          newId,
          interval.id,
        );
      }
      continue;
    }
    db.prepare("UPDATE episode_intervals SET end_ms = ? WHERE id = ?").run(atMs, interval.id);
    db.prepare(
      `INSERT INTO episode_intervals (
        id, episode_id, session_id, source_id, start_ms, end_ms, assignment, origin
      ) VALUES (?, ?, ?, ?, ?, ?, 'primary', 'split')`,
    ).run(randomUUID(), newId, interval.session_id, interval.source_id, atMs, interval.end_ms);
  }
  refreshDuration(db, episodeId);
  refreshDuration(db, newId);
  assertNoPrimaryOverlap(db, episode.session_id);
  revise(db, episodeId, "split", { atMs, newId });
  return newId;
}

export function mergeEpisodes(db: Sql, episodeId: string, intoEpisodeId: string): void {
  const source = mustEpisode(db, episodeId);
  mustEpisode(db, intoEpisodeId);
  db.prepare("UPDATE episode_intervals SET episode_id = ? WHERE episode_id = ?").run(
    intoEpisodeId,
    episodeId,
  );
  db.prepare("DELETE FROM episodes WHERE id = ?").run(episodeId);
  refreshDuration(db, intoEpisodeId);
  assertNoPrimaryOverlap(db, source.session_id);
  revise(db, intoEpisodeId, "merge", { from: episodeId });
}

export function reassignInterval(db: Sql, intervalId: string, episodeId: string): void {
  const interval = db.prepare("SELECT * FROM episode_intervals WHERE id = ?").get(intervalId) as
    IntervalRow | undefined;
  if (!interval) throw new OctoError("missing_interval", intervalId);
  mustEpisode(db, episodeId);
  db.prepare("UPDATE episode_intervals SET episode_id = ? WHERE id = ?").run(episodeId, intervalId);
  refreshDuration(db, interval.episode_id);
  refreshDuration(db, episodeId);
  assertNoPrimaryOverlap(db, interval.session_id);
  revise(db, episodeId, "reassign", { intervalId });
}

function refreshDuration(db: Sql, episodeId: string): void {
  const rows = db
    .prepare(
      "SELECT source_id, start_ms, end_ms FROM episode_intervals WHERE episode_id = ? AND assignment = 'primary'",
    )
    .all(episodeId) as Array<{ source_id: string; start_ms: number; end_ms: number }>;
  const duration = totalDurationMs(
    rows.map((row) => ({ sourceId: row.source_id, startMs: row.start_ms, endMs: row.end_ms })),
  );
  db.prepare("UPDATE episodes SET duration_ms = ? WHERE id = ?").run(duration, episodeId);
}

type EpisodeRow = {
  id: string;
  session_id: string;
  activity_type: string;
  objective: string;
  label: string | null;
  summary: string | null;
};

function mustEpisode(db: Sql, episodeId: string): EpisodeRow {
  const row = db
    .prepare(
      "SELECT id, session_id, activity_type, objective, label, summary FROM episodes WHERE id = ?",
    )
    .get(episodeId) as EpisodeRow | undefined;
  if (!row) throw new OctoError("missing_episode", episodeId);
  return row;
}

function revise(db: Sql, episodeId: string, action: string, detail: unknown): void {
  db.prepare(
    `INSERT INTO episode_revisions (id, episode_id, action, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), episodeId, action, JSON.stringify(detail), new Date().toISOString());
}
