import { randomUUID } from "node:crypto";
import type { Sql } from "../storage/db.js";

export type JobRow = {
  id: string;
  session_id: string | null;
  type: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload_json: string;
  result_json: string | null;
  run_after_ms: number;
};

export type JobEffect = (job: JobRow) => unknown;

export class JobRunner {
  constructor(private readonly db: Sql) {}

  enqueue(input: {
    sessionId: string | null;
    type: string;
    idempotencyKey: string;
    payload: unknown;
    now: number;
  }): JobRow {
    const existing = this.db
      .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as JobRow | undefined;
    if (existing) return existing;
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO jobs (
          id, session_id, type, idempotency_key, status, attempts, max_attempts,
          run_after_ms, payload_json, created_at
        ) VALUES (?, ?, ?, ?, 'queued', 0, 5, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.type,
        input.idempotencyKey,
        input.now,
        JSON.stringify(input.payload),
        new Date(input.now).toISOString(),
      );
    return this.must(id);
  }

  lease(owner: string, now: number): JobRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND run_after_ms <= ?
         ORDER BY created_at LIMIT 1`,
      )
      .get(now) as JobRow | undefined;
    if (!row) return undefined;
    this.db
      .prepare(
        `UPDATE jobs SET status = 'leased', lease_owner = ?, lease_until_ms = ?, attempts = attempts + 1
         WHERE id = ?`,
      )
      .run(owner, now + 30_000, row.id);
    return this.must(row.id);
  }

  runOnce(owner: string, now: number, effect: JobEffect): JobRow | undefined {
    const job = this.lease(owner, now);
    if (!job) return undefined;
    if (job.status === "succeeded") return job;
    const current = this.must(job.id);
    if (current.status === "cancelled") return current;
    try {
      const result = effect(current);
      const latest = this.must(current.id);
      if (latest.status === "cancelled") return latest;
      this.db
        .prepare(
          "UPDATE jobs SET status = 'succeeded', result_json = ? WHERE id = ? AND status = 'leased'",
        )
        .run(JSON.stringify(result ?? null), current.id);
    } catch (error) {
      const attempts = this.must(current.id).attempts;
      const failed = attempts >= current.max_attempts;
      this.db
        .prepare(`UPDATE jobs SET status = ?, run_after_ms = ?, result_json = ? WHERE id = ?`)
        .run(
          failed ? "failed" : "queued",
          now + attempts * 1000,
          JSON.stringify({ error: error instanceof Error ? error.message : "job failed" }),
          current.id,
        );
    }
    return this.must(job.id);
  }

  cancel(id: string): void {
    this.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(id);
  }

  list(): JobRow[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY created_at").all() as unknown as JobRow[];
  }

  private must(id: string): JobRow {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    if (!row) throw new Error(`missing job ${id}`);
    return row;
  }
}
