import { randomUUID } from "node:crypto";
import { acceptModelOutput } from "./policy.js";
import { askOllama, parseEpisodeGroups, probeOllama, type OllamaStatus } from "./ollama.js";
import type { Sql } from "../storage/db.js";

type FetchLike = typeof fetch;

export type LocalAnalysis = OllamaStatus & { episodes: number; reason: string };

function token(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

export async function analyzeLocalSession(input: {
  db: Sql;
  sessionId: string;
  sessionDurationMs: number;
  readText: (assetId: string) => string;
  fetchImpl?: FetchLike;
}): Promise<LocalAnalysis> {
  if (process.env.OCTO_MODEL === "off") {
    return { up: false, model: null, episodes: 0, reason: "disabled" };
  }
  const status = await probeOllama(input.fetchImpl);
  if (!status.up || !status.model) {
    return { up: false, model: null, episodes: 0, reason: "ollama_down" };
  }
  const existing = input.db
    .prepare("SELECT COUNT(*) AS count FROM episodes WHERE session_id = ?")
    .get(input.sessionId) as { count: number };
  if (existing.count > 0) {
    return { up: true, model: status.model, episodes: existing.count, reason: "already_analyzed" };
  }
  const evidence = input.db
    .prepare(
      "SELECT id, source_id, start_ms, asset_id FROM evidence WHERE session_id = ? ORDER BY start_ms",
    )
    .all(input.sessionId) as Array<{
    id: string;
    source_id: string;
    start_ms: number;
    asset_id: string;
  }>;
  if (evidence.length === 0) {
    return { up: true, model: status.model, episodes: 0, reason: "no_evidence" };
  }
  const lines = evidence.map((item) => {
    const text = input.readText(item.asset_id).slice(0, 500).replaceAll("\n", " ");
    return `- id=${item.id} offsetMs=${item.start_ms} text=${text}`;
  });
  let groups: ReturnType<typeof parseEpisodeGroups> = [];
  try {
    const content = await askOllama(status.model, lines.join("\n"), input.fetchImpl);
    groups = parseEpisodeGroups(content);
  } catch {
    return { up: true, model: status.model, episodes: 0, reason: "ollama_error" };
  }
  const known = new Map(evidence.map((item) => [item.id, item]));
  const episodes = groups.flatMap((group, index) => {
    const evidenceIds = group.evidenceIds.filter((id) => known.has(id));
    if (evidenceIds.length === 0) return [];
    const offsets = evidenceIds.map((id) => known.get(id)?.start_ms ?? 0);
    const span = Math.max(...offsets) - Math.min(...offsets);
    const durationMs = Math.min(span, input.sessionDurationMs);
    const episodeId = `${token(group.episodeId, `ep${index + 1}`).slice(0, 28)}-${randomUUID().slice(0, 8)}`;
    return [
      {
        episodeId,
        activityType: token(group.activityType, "activity"),
        evidenceIds,
        durationMs,
      },
    ];
  });
  if (episodes.length === 0) {
    return { up: true, model: status.model, episodes: 0, reason: "unusable_output" };
  }
  let accepted;
  try {
    accepted = acceptModelOutput(
      { episodes },
      new Set(evidence.map((item) => item.id)),
      input.sessionDurationMs,
    );
  } catch {
    return { up: true, model: status.model, episodes: 0, reason: "unusable_output" };
  }
  for (const episode of accepted.episodes) {
    input.db
      .prepare(
        `INSERT INTO episodes (id, session_id, activity_type, case_id, objective, review_state, duration_ms)
         VALUES (?, ?, ?, NULL, ?, 'proposed', ?)`,
      )
      .run(
        episode.episodeId,
        input.sessionId,
        episode.activityType,
        `Attività ${episode.activityType}`,
        episode.durationMs,
      );
    for (const evidenceId of episode.evidenceIds) {
      const row = evidence.find((item) => item.id === evidenceId);
      if (!row) continue;
      input.db
        .prepare(
          `INSERT INTO episode_intervals (
            id, episode_id, session_id, source_id, start_ms, end_ms, assignment, origin
          ) VALUES (?, ?, ?, ?, ?, ?, 'primary', 'ollama')`,
        )
        .run(
          randomUUID(),
          episode.episodeId,
          input.sessionId,
          row.source_id,
          row.start_ms,
          row.start_ms,
        );
    }
  }
  return {
    up: true,
    model: status.model,
    episodes: accepted.episodes.length,
    reason: "analyzed",
  };
}
