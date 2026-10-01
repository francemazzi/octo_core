import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DeterministicMediaEncoder,
  NoopAppContextAdapter,
  SyntheticCaptureAdapter,
  segmentIsValid,
} from "@octo/capture-adapter";
import { loadSessionOracle } from "@octo/test-fixtures";
import type { EconomicsInput } from "@octo/contracts";
import { ingestFrame, nextSequence } from "./capture/ingest.js";
import { InMemoryKeyProvider, type KeyProvider } from "./crypto/key-provider.js";
import { computeEconomics } from "./domain/economics.js";
import { assertSingleEpoch, durationFromOffsets } from "./sessions/clock.js";
import { assertCaptureTransition, type CaptureState } from "./sessions/machine.js";
import { OctoError } from "./errors.js";
import { runSessionGraph } from "./analysis/graph.js";
import { answerQuestion, deferQuestion } from "./analysis/questions.js";
import { JobRunner, type JobRow } from "./jobs/runner.js";
import { applyRetention, evaluateQuota } from "./jobs/quota.js";
import { readDiagnostic, writeDiagnostic } from "./diagnostics/log.js";
import { exportSessionTree, type ReportSnapshot } from "./reports/export.js";
import { confirmEpisode, mergeEpisodes, reassignInterval, splitEpisode } from "./review/service.js";
import { openDatabase, type Sql } from "./storage/db.js";
import { MediaStore } from "./storage/media-store.js";

export type EngineOptions = {
  keyProvider?: KeyProvider;
  nowMono?: () => number;
  nowWall?: () => string;
  offline?: boolean;
  quotaThresholdBytes?: number;
};

type SessionRow = {
  id: string;
  project_id: string;
  capture_state: CaptureState;
  analysis_state: string;
  scope_json: string;
  policy_version: string;
  epoch_id: string;
  started_wall: string;
};

export function createEngine(dataDir: string, options: EngineOptions = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(join(dataDir, "octo.db"));
  const keys = options.keyProvider ?? new InMemoryKeyProvider();
  const media = new MediaStore(db, dataDir, keys);
  const jobs = new JobRunner(db);
  const oracle = loadSessionOracle();
  const adapter = new SyntheticCaptureAdapter(oracle);
  const appContext = new NoopAppContextAdapter();
  const encoder = new DeterministicMediaEncoder();
  let mono = 10_000;
  let wall = "2026-01-15T08:00:00.000Z";
  let offline = options.offline ?? false;
  const nowMono = options.nowMono ?? (() => mono);
  const nowWall = options.nowWall ?? (() => wall);
  const quotaThreshold = options.quotaThresholdBytes ?? 1_000_000;

  function active(): SessionRow | undefined {
    return db
      .prepare(
        `SELECT * FROM sessions WHERE capture_state IN ('recording', 'paused') ORDER BY started_wall DESC LIMIT 1`,
      )
      .get() as SessionRow | undefined;
  }

  function requireSession(): SessionRow {
    const session =
      active() ??
      (db.prepare("SELECT * FROM sessions ORDER BY started_wall DESC LIMIT 1").get() as
        SessionRow | undefined);
    if (!session) throw new OctoError("no_session", "no session");
    return session;
  }

  function addEvent(session: SessionRow, kind: string, offset: number): void {
    db.prepare(
      `INSERT INTO capture_events (id, session_id, wall_time, offset_ms, epoch_id, sequence, kind, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
    ).run(
      randomUUID(),
      session.id,
      nowWall(),
      offset,
      session.epoch_id,
      nextSequence(db, session.id),
      kind,
    );
  }

  return {
    db,
    dataDir,
    appContext,
    close(): void {
      db.close();
    },
    setMono(value: number): void {
      mono = value;
    },
    setWall(value: string): void {
      wall = value;
    },
    setOffline(value: boolean): void {
      offline = value;
    },
    handshake() {
      return {
        version: 1,
        capabilities: ["synthetic_capture", "local_only", "sqlite", "noop_app_context"],
      };
    },
    startSession(input: {
      projectId: string;
      operatorPseudonym: string;
      sourceIds: string[];
      purpose: string;
    }) {
      if (!keys.available) throw new OctoError("keystore_unavailable", "recording cannot start");
      const existing = db
        .prepare(
          `SELECT * FROM sessions WHERE project_id = ? AND capture_state IN ('recording', 'paused')`,
        )
        .get(input.projectId) as SessionRow | undefined;
      if (existing) return { sessionId: existing.id, capture: existing.capture_state };
      const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId) as
        { id: string } | undefined;
      if (!project) {
        db.prepare(
          `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
           VALUES (?, ?, 'local_only', '{}', '{}', ?)`,
        ).run(input.projectId, input.purpose, nowWall());
      }
      const sessionId = randomUUID();
      const epochId = randomUUID();
      const origin = nowMono();
      db.prepare(
        `INSERT INTO sessions (
          id, project_id, operator_pseudonym, started_wall, capture_state, analysis_state,
          scope_json, policy_version, epoch_id, data_mode
        ) VALUES (?, ?, ?, ?, 'recording', 'idle', ?, 'mvp-1', ?, 'local_only')`,
      ).run(
        sessionId,
        input.projectId,
        input.operatorPseudonym,
        nowWall(),
        JSON.stringify(input.sourceIds),
        epochId,
      );
      db.prepare(
        `INSERT INTO clock_epochs (id, session_id, process_start_wall, monotonic_origin_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(epochId, sessionId, nowWall(), origin);
      for (const source of oracle.session.sources) {
        if (!input.sourceIds.includes(source.id)) continue;
        db.prepare(
          `INSERT INTO capture_sources (
            id, session_id, kind, geometry_json, dpi_scale, authorized, valid_from_ms
          ) VALUES (?, ?, ?, '{}', 1, ?, 0)`,
        ).run(source.id, sessionId, source.kind, source.authorized ? 1 : 0);
      }
      const session = requireSession();
      addEvent(session, "start", 0);
      return { sessionId, capture: "recording" as const };
    },
    transition(to: CaptureState): void {
      const session = active();
      if (!session) throw new OctoError("invalid_transition", "no active session");
      assertCaptureTransition(session.capture_state, to);
      db.prepare("UPDATE sessions SET capture_state = ?, ended_wall = ? WHERE id = ?").run(
        to,
        to === "stopped" ? nowWall() : null,
        session.id,
      );
      const origin = db
        .prepare("SELECT monotonic_origin_ms FROM clock_epochs WHERE id = ?")
        .get(session.epoch_id) as { monotonic_origin_ms: number };
      addEvent({ ...session, capture_state: to }, to, nowMono() - origin.monotonic_origin_ms);
    },
    pauseSession(): void {
      this.transition("paused");
    },
    resumeSession(): void {
      this.transition("recording");
    },
    stopSession(): void {
      this.transition("stopped");
    },
    openEpoch(sessionId: string): string {
      const epochId = randomUUID();
      const origin = nowMono();
      db.prepare(
        `INSERT INTO clock_epochs (id, session_id, process_start_wall, monotonic_origin_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(epochId, sessionId, nowWall(), origin);
      db.prepare("UPDATE sessions SET epoch_id = ? WHERE id = ?").run(epochId, sessionId);
      db.prepare(
        `INSERT INTO capture_events (id, session_id, wall_time, offset_ms, epoch_id, sequence, kind, detail_json)
         VALUES (?, ?, ?, 0, ?, ?, 'epoch', '{}')`,
      ).run(randomUUID(), sessionId, nowWall(), epochId, nextSequence(db, sessionId));
      return epochId;
    },
    mixedDuration(): number {
      const session = requireSession();
      const rows = db
        .prepare("SELECT offset_ms, epoch_id FROM capture_events WHERE session_id = ?")
        .all(session.id) as Array<{ offset_ms: number; epoch_id: string }>;
      assertSingleEpoch(rows.map((row) => row.epoch_id));
      return durationFromOffsets(rows[0]?.offset_ms ?? 0, rows[rows.length - 1]?.offset_ms ?? 0);
    },
    approveEvidence(evidenceId: string): void {
      db.prepare("UPDATE evidence SET review_state = 'approved' WHERE id = ?").run(evidenceId);
    },
    durationMs(): number {
      const session = requireSession();
      const rows = db
        .prepare(
          "SELECT offset_ms, epoch_id FROM capture_events WHERE session_id = ? ORDER BY sequence",
        )
        .all(session.id) as Array<{ offset_ms: number; epoch_id: string }>;
      const same = rows.filter((row) => row.epoch_id === session.epoch_id);
      if (same.length < 2) return 0;
      const start = same[0]?.offset_ms ?? 0;
      const end = same[same.length - 1]?.offset_ms ?? 0;
      return durationFromOffsets(start, end);
    },
    replayCapture() {
      const session = requireSession();
      const selected = new Set(JSON.parse(session.scope_json) as string[]);
      const authorized = adapter.authorizedSourceIds(selected);
      let stored = 0;
      let dropped = 0;
      const timeline = [
        ...adapter
          .events()
          .map((event) => ({ kind: "event" as const, offsetMs: event.offsetMs, event })),
        ...adapter
          .frames()
          .map((frame) => ({ kind: "frame" as const, offsetMs: frame.offsetMs, frame })),
      ].sort((a, b) => a.offsetMs - b.offsetMs);
      for (const item of timeline) {
        if (item.kind === "event") {
          db.prepare(
            `INSERT INTO capture_events (id, session_id, wall_time, offset_ms, epoch_id, sequence, kind, detail_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
          ).run(
            randomUUID(),
            session.id,
            nowWall(),
            item.offsetMs,
            session.epoch_id,
            nextSequence(db, session.id),
            item.event.kind,
          );
          continue;
        }
        const result = ingestFrame(db, media, {
          sessionId: session.id,
          captureState: session.capture_state,
          authorized,
          frameId: item.frame.id,
          sourceId: item.frame.sourceId,
          offsetMs: item.frame.offsetMs,
          payload: item.frame.payload,
          epochId: session.epoch_id,
          wall: nowWall(),
        });
        if (result.stored) stored += 1;
        else dropped += 1;
      }
      return { stored, dropped };
    },
    ingestFrame(frame: { frameId: string; sourceId: string; offsetMs: number; payload: string }) {
      const session = requireSession();
      const selected = new Set(JSON.parse(session.scope_json) as string[]);
      return ingestFrame(db, media, {
        sessionId: session.id,
        captureState: session.capture_state,
        authorized: adapter.authorizedSourceIds(selected),
        ...frame,
        epochId: session.epoch_id,
        wall: nowWall(),
      });
    },
    async runAnalysis(mode: "local_only" | "cloud_after_review" | "cloud_live_authorized") {
      const session = requireSession();
      db.prepare("UPDATE sessions SET analysis_state = 'running', data_mode = ? WHERE id = ?").run(
        mode,
        session.id,
      );
      const refreshed = requireSession();
      const result = await runSessionGraph(db, refreshed, mode, nowMono());
      return { ...result, capture: requireSession().capture_state };
    },
    answerQuestion(input: { questionId: string; episodeId: string; text: string }) {
      return answerQuestion(db, { ...input, nowIso: nowWall() });
    },
    deferQuestion(questionId: string) {
      deferQuestion(db, questionId);
    },
    confirmEpisode(episodeId: string) {
      confirmEpisode(db, episodeId);
    },
    splitEpisode(episodeId: string, atMs: number) {
      return splitEpisode(db, episodeId, atMs);
    },
    mergeEpisodes(episodeId: string, intoEpisodeId: string) {
      mergeEpisodes(db, episodeId, intoEpisodeId);
    },
    reassignInterval(intervalId: string, episodeId: string) {
      reassignInterval(db, intervalId, episodeId);
    },
    setObjective(episodeId: string, objective: string) {
      db.prepare("UPDATE episodes SET objective = ? WHERE id = ?").run(objective, episodeId);
    },
    saveOpportunity(problem: string, input: Partial<EconomicsInput>) {
      const session = requireSession();
      const economics = computeEconomics(input);
      db.prepare(
        `INSERT INTO opportunities (id, session_id, problem, evidence_json, alternative, economics_json, missing_json)
         VALUES (?, ?, ?, '[]', 'verify', ?, ?)`,
      ).run(
        randomUUID(),
        session.id,
        problem,
        JSON.stringify(economics),
        JSON.stringify(economics.status === "unknown" ? economics.missing : []),
      );
      return economics;
    },
    async exportSession(destination: string, status: "draft" | "approved") {
      return exportSessionTree(db, dataDir, destination, status);
    },
    revokeEvidence(evidenceId: string) {
      const session = requireSession();
      db.prepare("UPDATE evidence SET availability = 'revoked' WHERE id = ?").run(evidenceId);
      db.prepare(
        `INSERT INTO tombstones (id, session_id, evidence_id, created_at) VALUES (?, ?, ?, ?)`,
      ).run(randomUUID(), session.id, evidenceId, nowWall());
      db.prepare(
        `UPDATE episodes SET review_state = 'invalidated'
         WHERE session_id = ? AND review_state != 'confirmed'`,
      ).run(session.id);
    },
    enqueueDerive(evidenceId: string): JobRow {
      const session = requireSession();
      return jobs.enqueue({
        sessionId: session.id,
        type: "derive",
        idempotencyKey: `derive:${evidenceId}`,
        payload: { evidenceId },
        now: nowMono(),
      });
    },
    runJobs(): JobRow | undefined {
      return jobs.runOnce("engine", nowMono(), (job) => {
        if (offline && job.type === "ai-remote")
          throw new OctoError("offline", "queued until online");
        const payload = JSON.parse(job.payload_json) as { evidenceId?: string };
        if (payload.evidenceId) {
          const tomb = db
            .prepare("SELECT id FROM tombstones WHERE evidence_id = ?")
            .get(payload.evidenceId) as { id: string } | undefined;
          if (tomb) return { skipped: true };
          const latest = db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as {
            status: string;
          };
          if (latest.status === "cancelled") return { skipped: true };
        }
        if (job.type === "audit-once") {
          db.prepare(
            `INSERT INTO audit_events (id, session_id, wall_time, action, detail_json)
             VALUES (?, ?, ?, 'job_effect', '{}')`,
          ).run(randomUUID(), job.session_id, nowWall());
        }
        return { applied: true };
      });
    },
    enqueueOnce(key: string) {
      const session = requireSession();
      return jobs.enqueue({
        sessionId: session.id,
        type: "audit-once",
        idempotencyKey: key,
        payload: {},
        now: nowMono(),
      });
    },
    enqueueRemote() {
      const session = requireSession();
      return jobs.enqueue({
        sessionId: session.id,
        type: "ai-remote",
        idempotencyKey: `ai:${session.id}`,
        payload: {},
        now: nowMono(),
      });
    },
    cancelJob(id: string) {
      jobs.cancel(id);
    },
    applyDiskPressure(availableBytes: number) {
      const decision = evaluateQuota(availableBytes, quotaThreshold);
      if (decision === "pause" && active()?.capture_state === "recording") this.pauseSession();
      return { decision, retention: applyRetention(db, dataDir) };
    },
    protectDraft(path: string) {
      const session = requireSession();
      db.prepare(
        "INSERT INTO protected_reports (id, session_id, path, approved) VALUES (?, ?, ?, 0)",
      ).run(randomUUID(), session.id, path);
    },
    writeLog(line: string) {
      writeDiagnostic(dataDir, line);
    },
    readLog() {
      return readDiagnostic(dataDir);
    },
    deletePerimeter() {
      const session = requireSession();
      const evidence = db
        .prepare("SELECT id FROM evidence WHERE session_id = ?")
        .all(session.id) as Array<{
        id: string;
      }>;
      for (const item of evidence) {
        db.prepare(
          `INSERT INTO tombstones (id, session_id, evidence_id, created_at) VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), session.id, item.id, nowWall());
      }
      rmSync(join(dataDir, "media"), { recursive: true, force: true });
      db.prepare("DELETE FROM evidence WHERE session_id = ?").run(session.id);
      db.prepare("DELETE FROM assets WHERE session_id = ?").run(session.id);
      db.prepare("UPDATE sessions SET capture_state = 'stopped' WHERE id = ?").run(session.id);
    },
    encodeClip(hashes: string[], finalized: boolean) {
      const bytes = encoder.encode(
        hashes.map((hash) => ({ hash })),
        finalized,
      );
      const state = segmentIsValid(finalized) ? "valid" : "partial";
      return { bytes: Buffer.from(bytes).toString("utf8"), state, hasAudio: false as const };
    },
    listEvidence() {
      return db.prepare("SELECT * FROM evidence").all();
    },
    listAssets() {
      return db.prepare("SELECT * FROM assets").all();
    },
    listEvents() {
      return db.prepare("SELECT * FROM capture_events ORDER BY sequence").all();
    },
    listEpisodes() {
      return db.prepare("SELECT * FROM episodes").all();
    },
    listQuestions() {
      return db.prepare("SELECT * FROM questions").all();
    },
    listJobs() {
      return jobs.list();
    },
    corrections(projectId: string) {
      return {
        add(note: string) {
          const id = randomUUID();
          db.prepare(
            `INSERT INTO corrections (id, project_id, episode_id, note, revoked_at) VALUES (?, ?, NULL, ?, NULL)`,
          ).run(id, projectId, note);
          return id;
        },
        revoke(id: string) {
          db.prepare("UPDATE corrections SET revoked_at = ? WHERE id = ?").run(nowWall(), id);
        },
        active() {
          return db
            .prepare("SELECT * FROM corrections WHERE project_id = ? AND revoked_at IS NULL")
            .all(projectId);
        },
        trainingExport() {
          return [] as unknown[];
        },
      };
    },
    media,
    networkAudits() {
      return db.prepare("SELECT * FROM audit_events WHERE action = 'network'").all();
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
export type { ReportSnapshot, Sql };
