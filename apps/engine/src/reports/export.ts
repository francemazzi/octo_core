import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Document, Packer, Paragraph, TextRun } from "docx";
import type { Sql } from "../storage/db.js";
import { escapeHtml, resolveInside, safePathSegment } from "./paths.js";

export type ReportSnapshot = {
  version: number;
  sessionId: string;
  status: "draft" | "approved";
  episodes: Array<{
    id: string;
    activityType: string;
    durationMs: number;
    objective: string;
    reviewState: string;
  }>;
  opportunities: Array<{ problem: string; economics: unknown }>;
  missingClips: boolean;
  unknownMs: number;
};

export async function exportSessionTree(
  db: Sql,
  dataDir: string,
  destination: string,
  status: "draft" | "approved",
): Promise<{ version: number; snapshot: ReportSnapshot }> {
  const session = db.prepare("SELECT id FROM sessions ORDER BY started_wall DESC LIMIT 1").get() as
    { id: string } | undefined;
  if (!session) throw new Error("no session");
  const previous = db
    .prepare("SELECT MAX(version) AS version FROM report_versions WHERE session_id = ?")
    .get(session.id) as { version: number | null };
  const version = (previous.version ?? 0) + 1;
  const episodes = db
    .prepare(
      `SELECT id, activity_type, duration_ms, objective, review_state FROM episodes WHERE session_id = ?`,
    )
    .all(session.id) as Array<{
    id: string;
    activity_type: string;
    duration_ms: number;
    objective: string;
    review_state: string;
  }>;
  const opportunities = db
    .prepare("SELECT problem, economics_json FROM opportunities WHERE session_id = ?")
    .all(session.id) as Array<{ problem: string; economics_json: string }>;
  const summary = db
    .prepare(
      `SELECT detail_json FROM audit_events WHERE session_id = ? AND action = 'time_summary' ORDER BY wall_time DESC LIMIT 1`,
    )
    .get(session.id) as { detail_json: string } | undefined;
  const unknownMs = summary
    ? (JSON.parse(summary.detail_json) as { unknownMs: number }).unknownMs
    : 0;
  const snapshot: ReportSnapshot = {
    version,
    sessionId: session.id,
    status,
    episodes: episodes.map((episode) => ({
      id: episode.id,
      activityType: episode.activity_type,
      durationMs: episode.duration_ms,
      objective: episode.objective,
      reviewState: episode.review_state,
    })),
    opportunities: opportunities.map((item) => ({
      problem: item.problem,
      economics: JSON.parse(item.economics_json) as unknown,
    })),
    missingClips: true,
    unknownMs,
  };

  const root = resolveInside(destination);
  mkdirSync(resolveInside(root, "report"), { recursive: true });
  if (unknownMs > 0) mkdirSync(resolveInside(root, "da-verificare"), { recursive: true });
  writeFileSync(
    resolveInside(root, "report", "riepilogo-sessione.json"),
    JSON.stringify(snapshot, null, 2),
  );
  writeFileSync(
    resolveInside(root, "report", "riepilogo-sessione.docx"),
    await renderDocx(snapshot),
  );
  writeFileSync(resolveInside(root, "indice.html"), renderIndex(snapshot));
  for (const episode of snapshot.episodes) {
    const type = safePathSegment(episode.activityType);
    const id = safePathSegment(episode.id);
    const dir = resolveInside(root, "attivita", type, id);
    mkdirSync(dir, { recursive: true });
    const intervals = db
      .prepare(
        `SELECT source_id, start_ms, end_ms, assignment FROM episode_intervals WHERE episode_id = ?`,
      )
      .all(episode.id) as Array<{
      source_id: string;
      start_ms: number;
      end_ms: number;
      assignment: string;
    }>;
    writeFileSync(
      join(dir, "activity.json"),
      JSON.stringify(
        {
          episodeId: episode.id,
          activityType: episode.activityType,
          objective: episode.objective,
          status: episode.reviewState,
          durationMs: episode.durationMs,
          intervals: intervals.map((interval) => ({
            sourceId: interval.source_id,
            startMs: interval.start_ms,
            endMs: interval.end_ms,
            assignment: interval.assignment,
          })),
        },
        null,
        2,
      ),
    );
  }
  if (unknownMs > 0) {
    writeFileSync(
      resolveInside(root, "da-verificare", "tratto-non-classificato.txt"),
      "Tratto senza classificazione. Durata conservata.\n",
    );
  }

  db.prepare(
    `INSERT INTO report_versions (id, session_id, version, status, author, snapshot_json, created_at)
     VALUES (?, ?, ?, ?, 'operator', ?, ?)`,
  ).run(
    randomUUID(),
    session.id,
    version,
    status,
    JSON.stringify(snapshot),
    new Date().toISOString(),
  );

  if (status === "approved") {
    const approvedDir = resolveInside(dataDir, "reports", "approved");
    mkdirSync(approvedDir, { recursive: true });
    const approvedPath = join(approvedDir, `riepilogo-sessione-v${version}.docx`);
    writeFileSync(approvedPath, await renderDocx(snapshot));
    db.prepare(
      `INSERT INTO protected_reports (id, session_id, path, approved) VALUES (?, ?, ?, 1)`,
    ).run(randomUUID(), session.id, approvedPath);
  }

  return { version, snapshot };
}

async function renderDocx(snapshot: ReportSnapshot): Promise<Buffer> {
  const children = [
    new Paragraph({
      children: [new TextRun(`Stato: ${snapshot.status === "approved" ? "approvato" : "bozza"}`)],
    }),
    new Paragraph({ children: [new TextRun(`Sessione ${snapshot.sessionId}`)] }),
    ...snapshot.episodes.map(
      (episode) =>
        new Paragraph({
          children: [
            new TextRun(
              `${episode.id} ${episode.activityType} ${episode.durationMs} ms ${episode.objective}`,
            ),
          ],
        }),
    ),
    new Paragraph({
      children: [new TextRun(snapshot.missingClips ? "Clip: non disponibili" : "Clip: presenti")],
    }),
  ];
  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

function renderIndex(snapshot: ReportSnapshot): string {
  const items = snapshot.episodes
    .map((episode) => `<li>${escapeHtml(episode.objective)} (${escapeHtml(episode.id)})</li>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Indice</title></head><body><ul>${items}</ul></body></html>\n`;
}
