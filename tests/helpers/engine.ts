import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, type Engine } from "@octo/engine";

export function tempEngine(): { dir: string; engine: Engine } {
  const dir = mkdtempSync(join(tmpdir(), "octo-"));
  return { dir, engine: createEngine(dir) };
}

export function startDemo(engine: Engine): { sessionId: string } {
  return engine.startSession({
    projectId: "oracle-project",
    operatorPseudonym: "op-demo",
    sourceIds: ["mon-1", "mon-2"],
    purpose: "Inserimento ordini",
  });
}
