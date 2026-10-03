import { createInterface } from "node:readline";
import { engineCommandSchema, PROTOCOL_VERSION, type EngineCommand } from "@octo/contracts";
import { createEngine, type Engine } from "../create-engine.js";
import { OctoError } from "../errors.js";

export async function dispatch(engine: Engine, command: EngineCommand): Promise<unknown> {
  switch (command.cmd) {
    case "handshake":
      return engine.handshake();
    case "shutdown":
      return { status: "bye" };
    case "session.start":
      return engine.startSession(command);
    case "session.pause":
      engine.pauseSession();
      return { capture: "paused" };
    case "session.resume":
      engine.resumeSession();
      return { capture: "recording" };
    case "session.stop":
      engine.stopSession();
      return { capture: "stopped" };
    case "session.state":
      return { durationMs: engine.durationMs() };
    case "capture.replay":
      return engine.replayCapture();
    case "capture.frame":
      return engine.ingestFrame(command);
    case "analysis.run":
      return engine.runAnalysis(command.mode);
    case "model.status":
      return engine.modelStatus();
    case "analysis.local":
      return engine.analyzeLocal();
    case "report.tick":
      return engine.reportTick();
    case "question.answer":
      return engine.answerQuestion(command);
    case "question.defer":
      engine.deferQuestion(command.questionId);
      return { status: "deferred" };
    case "review.confirm":
      engine.confirmEpisode(command.episodeId);
      return { status: "confirmed" };
    case "review.split":
      return { episodeId: engine.splitEpisode(command.episodeId, command.atMs) };
    case "review.merge":
      engine.mergeEpisodes(command.episodeId, command.intoEpisodeId);
      return { status: "merged" };
    case "export.run":
      return engine.exportSession(command.destination, command.status);
    case "diagnostics.log":
      return {
        guide: "Stop ferma la sessione. Revoca elimina un'evidenza. Annulla ferma un job in coda.",
      };
    case "session.delete":
      engine.deletePerimeter();
      return { status: "deleted" };
    default:
      throw new OctoError("invalid_payload", "unknown command");
  }
}

export async function serve(engine: Engine = createEngine(requiredDataDir())): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  const write = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      write({
        v: 1,
        id: "unknown",
        ok: false,
        error: { code: "invalid_payload", message: "malformed json" },
      });
      continue;
    }
    const record = raw as { v?: unknown; id?: unknown };
    const id = typeof record.id === "string" ? record.id : "unknown";
    if (record.v !== PROTOCOL_VERSION) {
      write({
        v: 1,
        id,
        ok: false,
        error: { code: "incompatible_version", message: `unsupported version ${String(record.v)}` },
      });
      continue;
    }
    const parsed = engineCommandSchema.safeParse(raw);
    if (!parsed.success) {
      write({
        v: 1,
        id,
        ok: false,
        error: { code: "invalid_payload", message: "schema rejected" },
      });
      continue;
    }
    try {
      const result = await dispatch(engine, parsed.data);
      write({ v: 1, id, ok: true, result });
      if (parsed.data.cmd === "shutdown") {
        engine.close();
        lines.close();
        return;
      }
    } catch (error) {
      const code = error instanceof OctoError ? error.code : "internal";
      const message = error instanceof Error ? error.message : "error";
      write({ v: 1, id, ok: false, error: { code, message } });
    }
  }
}

function requiredDataDir(): string {
  const dataDir = process.env.OCTO_DATA_DIR;
  if (!dataDir) throw new OctoError("no_data_dir", "OCTO_DATA_DIR is required");
  return dataDir;
}
