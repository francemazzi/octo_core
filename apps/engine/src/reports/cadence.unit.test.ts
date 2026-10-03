import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";
import { reportDecision, THREE_DAYS_MS, tickMiniReport } from "./cadence.js";

describe("mini report cadence", () => {
  it("waits three days from the first session, then writes one report", async () => {
    expect(
      reportDecision({
        earliestSessionMs: null,
        lastReportMs: null,
        nowMs: 0,
        intervalMs: THREE_DAYS_MS,
      }),
    ).toEqual({ due: false, reason: "no_session" });
    expect(
      reportDecision({
        earliestSessionMs: 0,
        lastReportMs: null,
        nowMs: THREE_DAYS_MS - 1,
        intervalMs: THREE_DAYS_MS,
      }),
    ).toEqual({ due: false, reason: "waiting" });

    const dir = mkdtempSync(join(tmpdir(), "octo-cadence-"));
    const database = openDatabase(join(dir, "octo.db"));
    database
      .prepare(
        `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
         VALUES ('p', 'demo', 'local', '{}', '{}', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    const started = new Date(Date.now() - THREE_DAYS_MS - 1_000).toISOString();
    database
      .prepare(
        `INSERT INTO sessions (
          id, project_id, operator_pseudonym, started_wall, capture_state, analysis_state,
          scope_json, policy_version, epoch_id
        ) VALUES ('s', 'p', 'op', ?, 'stopped', 'idle', '[]', 'mvp-1', 'e')`,
      )
      .run(started);

    const issued = await tickMiniReport({ db: database, dataDir: dir });
    expect(issued.reason).toBe("issued");
    expect(issued.path && existsSync(issued.path)).toBe(true);
    const waiting = await tickMiniReport({ db: database, dataDir: dir });
    expect(waiting).toMatchObject({ issued: false, reason: "waiting" });
    database.close();
  });
});
