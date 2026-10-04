import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { app } from "electron";

export type EngineReply = { ok: boolean; result?: unknown; error?: { message: string } };

export type EngineRequest = (
  command: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<EngineReply>;

function spawnEngine(dataDir: string, here: string): ChildProcessWithoutNullStreams {
  const env = {
    ...process.env,
    OCTO_DATA_DIR: dataDir,
    OCTO_CAPTURE: process.env.OCTO_CAPTURE ?? "screen",
  };
  if (app.isPackaged) {
    return spawn(process.execPath, [join(process.resourcesPath, "engine.mjs")], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const repoRoot = process.env.OCTO_REPO_ROOT ?? join(here, "..", "..", "..");
  const engineEntry = process.env.OCTO_ENGINE_ENTRY ?? join(repoRoot, "apps/engine/src/main.ts");
  // Dev only: the repo .env (model keys) fills what the shell did not set. Packaged builds never read it.
  const envFile = join(repoRoot, ".env");
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  return spawn("pnpm", ["exec", "tsx", engineEntry], {
    cwd: repoRoot,
    env: { ...fromFile, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Starts the engine process and talks to it with newline-delimited JSON over stdio. */
export function createEngineClient(
  dataDir: string,
  here: string,
): { child: ChildProcessWithoutNullStreams; request: EngineRequest } {
  const child = spawnEngine(dataDir, here);
  const pending = new Map<string, (reply: EngineReply) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply: EngineReply & { id: string };
    try {
      reply = JSON.parse(line) as EngineReply & { id: string };
    } catch {
      process.stderr.write(`engine wrote a non-protocol line: ${line.slice(0, 200)}\n`);
      return;
    }
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });

  const request: EngineRequest = (command, timeoutMs = 10_000) => {
    const id = randomUUID();
    child.stdin.write(`${JSON.stringify({ v: 1, id, ...command })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("engine timeout"));
      }, timeoutMs);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        if (!reply.ok) reject(new Error(reply.error?.message ?? "engine error"));
        else resolve(reply);
      });
    });
  };
  return { child, request };
}
