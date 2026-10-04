import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EngineProcess } from "../helpers/process.js";

describe("A02 engine process", () => {
  it("speaks the protocol, rejects bad payloads, and can be killed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octo-a02-"));
    const engine = new EngineProcess(dir);
    const hello = await engine.request({ cmd: "handshake", clientVersion: 1 });
    expect(hello.ok).toBe(true);

    const malformed = await engine.request({ cmd: "session.start" });
    expect(malformed.ok).toBe(false);
    expect(malformed.error?.code).toBe("invalid_payload");

    engine.child.stdin.write("{}\n");
    const incompatible = await new Promise<{ error?: { code: string } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout version")), 5_000);
      const onData = (chunk: Buffer) => {
        const line = chunk
          .toString()
          .split("\n")
          .find((item) => item.includes("incompatible_version"));
        if (!line) return;
        clearTimeout(timer);
        engine.child.stdout.off("data", onData);
        resolve(JSON.parse(line) as { error?: { code: string } });
      };
      engine.child.stdout.on("data", onData);
      engine.child.stdin.write(
        `${JSON.stringify({ v: 99, id: "bad-version", cmd: "handshake", clientVersion: 1 })}\n`,
      );
    });
    expect(incompatible.error?.code).toBe("incompatible_version");

    const stillAlive = await engine.request({ cmd: "handshake", clientVersion: 1 });
    expect(stillAlive.ok).toBe(true);

    const exit = new Promise<NodeJS.Signals | null>((resolve) => {
      engine.child.once("exit", (_code, signal) => resolve(signal));
    });
    engine.child.kill("SIGKILL");
    expect(await exit).toBe("SIGKILL");
  });

  it("measures session time with the process clock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octo-a02-clock-"));
    const engine = new EngineProcess(dir);
    const started = await engine.request({
      cmd: "session.start",
      projectId: "oracle-project",
      operatorPseudonym: "op-demo",
      sourceIds: ["mon-1"],
      purpose: "clock",
    });
    expect(started.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await engine.request({ cmd: "session.stop" })).ok).toBe(true);
    const state = await engine.request({ cmd: "session.state" });
    expect((state.result as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(30);
    await engine.close();
  });

  it("answers a model question over the protocol and resumes the analysis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octo-a02-question-"));
    const engine = new EngineProcess(dir, { OCTO_MODEL: "fixture" });
    await engine.request({
      cmd: "session.start",
      projectId: "oracle-project",
      operatorPseudonym: "op-demo",
      sourceIds: ["mon-1", "mon-2"],
      purpose: "domande",
    });
    await engine.request({ cmd: "capture.replay" });
    const run = await engine.request({ cmd: "analysis.run", mode: "local_only" });
    expect(run.result).toMatchObject({ analysis: "awaiting_answer", reason: "accepted" });

    const listed = await engine.request({ cmd: "question.list" });
    const questions = (
      listed.result as { questions: Array<{ questionId: string; episodeId: string }> }
    ).questions;
    expect(questions).toHaveLength(1);
    const answer = await engine.request({
      cmd: "question.answer",
      questionId: questions[0]?.questionId,
      episodeId: questions[0]?.episodeId,
      text: "sì",
    });
    expect(answer.result).toEqual({ status: "accepted", analysis: "completed" });

    const listedSessions = await engine.request({ cmd: "session.list" });
    const sessions = (
      listedSessions.result as { sessions: Array<{ sessionId: string; title: string }> }
    ).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe("Inserimento ordine cliente");
    const detail = await engine.request({
      cmd: "session.detail",
      sessionId: sessions[0]?.sessionId,
    });
    expect((detail.result as { episodes: unknown[] }).episodes).toHaveLength(2);

    const removed = await engine.request({ cmd: "analysis.local" });
    expect(removed.error?.code).toBe("invalid_payload");
    await engine.close();
  });
});
