import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import type { Sql } from "../storage/db.js";

export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export function reportDecision(input: {
  earliestSessionMs: number | null;
  lastReportMs: number | null;
  nowMs: number;
  intervalMs: number;
}): { due: boolean; reason: string } {
  if (input.earliestSessionMs === null) return { due: false, reason: "no_session" };
  const anchor = input.lastReportMs ?? input.earliestSessionMs;
  if (input.nowMs - anchor < input.intervalMs) return { due: false, reason: "waiting" };
  return { due: true, reason: "due" };
}

type CadenceFile = { lastIssuedAt: string | null };

function readCadence(dataDir: string): CadenceFile {
  try {
    return JSON.parse(readFileSync(join(dataDir, "report-cadence.json"), "utf8")) as CadenceFile;
  } catch {
    return { lastIssuedAt: null };
  }
}

export async function tickMiniReport(input: {
  db: Sql;
  dataDir: string;
  nowMs?: number;
  intervalMs?: number;
}): Promise<{ due: boolean; issued: boolean; path: string | null; reason: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const intervalMs =
    input.intervalMs ?? Number(process.env.OCTO_REPORT_INTERVAL_MS ?? THREE_DAYS_MS);
  const earliest = input.db.prepare("SELECT MIN(started_wall) AS started FROM sessions").get() as {
    started: string | null;
  };
  const cadence = readCadence(input.dataDir);
  const decision = reportDecision({
    earliestSessionMs: earliest.started ? Date.parse(earliest.started) : null,
    lastReportMs: cadence.lastIssuedAt ? Date.parse(cadence.lastIssuedAt) : null,
    nowMs,
    intervalMs,
  });
  if (!decision.due) return { due: false, issued: false, path: null, reason: decision.reason };

  const since = cadence.lastIssuedAt ?? earliest.started ?? new Date(0).toISOString();
  const sessions = input.db
    .prepare(`SELECT id, started_wall FROM sessions WHERE started_wall >= ? ORDER BY started_wall`)
    .all(since) as Array<{ id: string; started_wall: string }>;
  const lines = ["Mini report Octo", `Dal ${since}`];
  for (const session of sessions) {
    lines.push(`Sessione ${session.id} ${session.started_wall}`);
    const episodes = input.db
      .prepare("SELECT activity_type, duration_ms, objective FROM episodes WHERE session_id = ?")
      .all(session.id) as Array<{
      activity_type: string;
      duration_ms: number;
      objective: string;
    }>;
    if (episodes.length === 0) lines.push("Nessun episodio estratto.");
    for (const episode of episodes) {
      const minutes = Math.round(episode.duration_ms / 60_000);
      lines.push(`${episode.activity_type}: ${minutes} min. ${episode.objective}`);
    }
  }
  const dir = join(input.dataDir, "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "mini-report.docx");
  const document = new Document({
    sections: [
      {
        children: lines.map((line) => new Paragraph({ children: [new TextRun(line)] })),
      },
    ],
  });
  writeFileSync(path, await Packer.toBuffer(document));
  const issuedAt = new Date(nowMs).toISOString();
  writeFileSync(
    join(input.dataDir, "report-cadence.json"),
    JSON.stringify({ lastIssuedAt: issuedAt }),
  );
  return { due: true, issued: true, path, reason: "issued" };
}
