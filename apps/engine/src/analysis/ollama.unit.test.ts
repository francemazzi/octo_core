import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type Sql } from "../storage/db.js";
import { analyzeLocalSession } from "./local-analysis.js";
import { parseEpisodeGroups, probeOllama } from "./ollama.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionDb(): Sql {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), "octo-ollama-")), "octo.db"));
  database
    .prepare(
      `INSERT INTO projects (id, purpose, collection_policy, taxonomy_json, retention_json, created_at)
       VALUES ('p', 'demo', 'local', '{}', '{}', '2026-01-15T00:00:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO sessions (
        id, project_id, operator_pseudonym, started_wall, capture_state, analysis_state,
        scope_json, policy_version, epoch_id
      ) VALUES ('s', 'p', 'op', '2026-01-15T00:00:00.000Z', 'stopped', 'idle', '[]', 'mvp-1', 'e')`,
    )
    .run();
  const insert = database.prepare(
    `INSERT INTO evidence (
      id, session_id, source_id, start_ms, end_ms, asset_id, content_hash, masks_json, availability
    ) VALUES (?, 's', 'mon-1', ?, ?, 'asset', 'hash', '[]', 'available')`,
  );
  insert.run("ev-a", 0, 0);
  insert.run("ev-b", 90_000, 90_000);
  return database;
}

describe("local Ollama boundary", () => {
  it("prefers a small instruct model and ignores embeddings", async () => {
    const fetchImpl = (async () =>
      json({
        models: [
          { name: "qwen38-27b-dsh:latest", capabilities: ["completion"] },
          { name: "bge-m3:latest", capabilities: ["embedding"] },
          { name: "qwen2.5:7b-instruct-q4_K_M", capabilities: ["completion"] },
        ],
      })) as typeof fetch;
    const previous = process.env.OCTO_OLLAMA_MODEL;
    delete process.env.OCTO_OLLAMA_MODEL;
    try {
      await expect(probeOllama(fetchImpl, "http://127.0.0.1:11434")).resolves.toEqual({
        up: true,
        model: "qwen2.5:7b-instruct-q4_K_M",
      });
    } finally {
      if (previous === undefined) delete process.env.OCTO_OLLAMA_MODEL;
      else process.env.OCTO_OLLAMA_MODEL = previous;
    }
  });

  it("reports Ollama down when the probe fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(probeOllama(fetchImpl, "http://127.0.0.1:11434")).resolves.toEqual({
      up: false,
      model: null,
    });
  });

  it("reads episode groups from a JSON object", () => {
    expect(
      parseEpisodeGroups(
        'note {"episodes":[{"episodeId":"ep1","activityType":"mail","evidenceIds":["ev-1", 2]}]}',
      ),
    ).toEqual([{ episodeId: "ep1", activityType: "mail", evidenceIds: ["ev-1"] }]);
    expect(parseEpisodeGroups("not json")).toEqual([]);
  });

  it("stores only known evidence and clamps duration to the session", async () => {
    const database = sessionDb();
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/tags")) {
        return json({
          models: [{ name: "qwen2.5:7b-instruct-q4_K_M", capabilities: ["completion"] }],
        });
      }
      return json({
        message: {
          content: JSON.stringify({
            episodes: [
              {
                episodeId: "order",
                activityType: "order entry",
                evidenceIds: ["ev-a", "ev-b", "ev-missing"],
              },
            ],
          }),
        },
      });
    }) as typeof fetch;
    const previous = process.env.OCTO_MODEL;
    delete process.env.OCTO_MODEL;
    try {
      const result = await analyzeLocalSession({
        db: database,
        sessionId: "s",
        sessionDurationMs: 60_000,
        readText: () => "testo",
        fetchImpl,
      });
      expect(result.reason).toBe("analyzed");
      expect(result.episodes).toBe(1);
      const stored = database.prepare("SELECT duration_ms FROM episodes").get() as {
        duration_ms: number;
      };
      expect(stored.duration_ms).toBe(60_000);
      const intervals = database
        .prepare("SELECT source_id, origin FROM episode_intervals")
        .all() as Array<{ source_id: string; origin: string }>;
      expect(intervals).toEqual([
        { source_id: "mon-1", origin: "ollama" },
        { source_id: "mon-1", origin: "ollama" },
      ]);
      expect(calls.some((url) => url.startsWith("http://127.0.0.1:11434"))).toBe(true);
      const again = await analyzeLocalSession({
        db: database,
        sessionId: "s",
        sessionDurationMs: 60_000,
        readText: () => "testo",
        fetchImpl,
      });
      expect(again.reason).toBe("already_analyzed");
      expect(calls.filter((url) => url.endsWith("/api/chat"))).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.OCTO_MODEL;
      else process.env.OCTO_MODEL = previous;
      database.close();
    }
  });
});
