import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";
import { latestRun, recordRun } from "./runs.js";

describe("analysis runs", () => {
  it("never reports a session assistant call as the last analysis", () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), "octo-runs-")), "octo.db"));
    db.prepare(
      `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
       VALUES ('p', 'demo', 'local_only', '{}', '{}', '2026-01-15T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, project_id, operator_pseudonym, started_wall, capture_state,
         analysis_state, scope_json, policy_version, epoch_id)
       VALUES ('s', 'p', 'op', '2026-01-15T00:00:00.000Z', 'stopped', 'idle', '[]', 'mvp-1', 'e')`,
    ).run();
    const base = { sessionId: "s", mode: "local_only" as const, provider: "fixture", at: "t" };
    expect(latestRun(db, "s")).toBeUndefined();
    recordRun(db, {
      ...base,
      model: "chat-model",
      promptSchema: "chat@1",
      outcome: "accepted",
      detail: { chat: true },
    });
    expect(latestRun(db, "s")).toBeUndefined();

    recordRun(db, {
      ...base,
      model: "analysis-model",
      promptSchema: "episodes@5",
      outcome: "accepted",
      detail: { evidenceSent: 1, evidenceTotal: 3 },
    });
    recordRun(db, {
      ...base,
      model: "chat-model",
      promptSchema: "chat@1",
      outcome: "rejected",
      detail: { chat: true, error: "invalid_model_output" },
    });
    expect(latestRun(db, "s")).toEqual({
      outcome: "accepted",
      model: "analysis-model",
      provider: "fixture",
      error: null,
      partial: true,
    });
    expect(latestRun(db, "s", { accepted: true })?.model).toBe("analysis-model");
    db.close();
  });
});
