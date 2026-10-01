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
});
