import { createInterface } from "node:readline";
import { engineCommandSchema, PROTOCOL_VERSION, type EngineCommand } from "@octo/contracts";
import { createEngine, type Engine } from "../create-engine.js";
import { OctoError } from "../errors.js";
import { runtimeOptions } from "./runtime.js";

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
    case "capture.image":
      return engine.captureImage(command);
    case "analysis.run":
      return engine.runAnalysis(command.mode, command.sessionId);
    case "model.status":
      return engine.modelStatus();
    case "report.tick":
      return engine.reportTick();
    case "question.answer":
      return engine.answerQuestion(command);
    case "question.list":
      return { questions: engine.openQuestions() };
    case "session.list":
      return { sessions: engine.listSessions(command.limit) };
    case "session.detail":
      return engine.sessionDetail(command.sessionId);
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
    case "model.configure":
      return {
        remote: await engine.configureRemoteModel({
          remote: command.remote,
          verify: command.verify,
        }),
      };
    case "review.approve":
      return engine.approveSession(command.sessionId);
    default:
      throw new OctoError("invalid_payload", "unknown command");
  }
}

/** Commands that may wait on a model or the disk: they share one lane and answer when done. */
const SLOW_COMMANDS: ReadonlySet<EngineCommand["cmd"]> = new Set([
  "analysis.run",
  "question.answer",
  "export.run",
  "report.tick",
  "session.delete",
]);
const SHUTDOWN_WAIT_MS = 5_000;

type Write = (message: unknown) => void;

/**
 * Parses one protocol line and answers it. Fast commands (pause, stop, start, state, lists) answer
 * at once, even while an analysis runs in the slow lane; replies are matched by `id`.
 */
export function createProtocolHandler(engine: Engine, write: Write) {
  let lane: Promise<void> = Promise.resolve();

  async function respond(id: string, command: EngineCommand): Promise<void> {
    try {
      write({ v: 1, id, ok: true, result: await dispatch(engine, command) });
    } catch (error) {
      const code = error instanceof OctoError ? error.code : "internal";
      const message = error instanceof Error ? error.message : "error";
      write({ v: 1, id, ok: false, error: { code, message } });
    }
  }

  function parse(line: string): { id: string; command: EngineCommand } | undefined {
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
      return undefined;
    }
    const record = (typeof raw === "object" && raw !== null ? raw : {}) as {
      v?: unknown;
      id?: unknown;
    };
    const id = typeof record.id === "string" ? record.id : "unknown";
    if (record.v !== PROTOCOL_VERSION) {
      const message = `unsupported version ${String(record.v)}`;
      write({ v: 1, id, ok: false, error: { code: "incompatible_version", message } });
      return undefined;
    }
    const parsed = engineCommandSchema.safeParse(raw);
    if (!parsed.success) {
      write({
        v: 1,
        id,
        ok: false,
        error: { code: "invalid_payload", message: "schema rejected" },
      });
      return undefined;
    }
    return { id, command: parsed.data };
  }

  return {
    /** Handles one line; resolves `true` once the engine has shut down. */
    async handle(line: string): Promise<boolean> {
      if (!line.trim()) return false;
      const request = parse(line);
      if (!request) return false;
      if (request.command.cmd === "shutdown") {
        await Promise.race([Promise.all([lane, engine.drainCapture()]), delay(SHUTDOWN_WAIT_MS)]);
        await respond(request.id, request.command);
        engine.close();
        return true;
      }
      if (SLOW_COMMANDS.has(request.command.cmd)) {
        lane = lane.then(() => respond(request.id, request.command));
        return false;
      }
      // Checking a key waits on the network: it must not hold Pausa or Stop behind it.
      if (request.command.cmd === "model.configure") {
        void respond(request.id, request.command);
        return false;
      }
      await respond(request.id, request.command);
      return false;
    },
    /** Resolves when every slow command queued so far has answered. */
    idle(): Promise<void> {
      return lane;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export async function serve(engine: Engine = startEngine()): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  const handler = createProtocolHandler(engine, (message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  });
  for await (const line of lines) {
    if (await handler.handle(line)) {
      lines.close();
      return;
    }
  }
}

function startEngine(): Engine {
  const engine = createEngine(requiredDataDir(), runtimeOptions());
  engine.reopenActiveEpochs();
  engine.releaseStaleAnalyses();
  return engine;
}

function requiredDataDir(): string {
  const dataDir = process.env.OCTO_DATA_DIR;
  if (!dataDir) throw new OctoError("no_data_dir", "OCTO_DATA_DIR is required");
  return dataDir;
}
