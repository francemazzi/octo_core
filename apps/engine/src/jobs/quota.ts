import { rmSync, statSync } from "node:fs";
import type { Sql } from "../storage/db.js";

export function evaluateQuota(availableBytes: number, thresholdBytes: number): "ok" | "pause" {
  return availableBytes < thresholdBytes ? "pause" : "ok";
}

export function applyRetention(db: Sql, dataDir: string): { removed: string[]; kept: string[] } {
  const protectedRows = db
    .prepare("SELECT path FROM protected_reports WHERE approved = 1")
    .all() as Array<{ path: string }>;
  const kept = protectedRows.map((row) => row.path).filter((path) => safeExists(path));
  const drafts = db
    .prepare("SELECT id, path FROM protected_reports WHERE approved = 0")
    .all() as Array<{ id: string; path: string }>;
  const removed: string[] = [];
  for (const draft of drafts) {
    if (draft.path.startsWith(dataDir)) {
      rmSync(draft.path, { force: true });
      removed.push(draft.path);
      db.prepare("DELETE FROM protected_reports WHERE id = ?").run(draft.id);
    }
  }
  return { removed, kept };
}

function safeExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
