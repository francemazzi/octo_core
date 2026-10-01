import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export type EngineReply = {
  v: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string };
};

export class EngineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, (reply: EngineReply) => void>();

  constructor(dataDir: string) {
    this.child = spawn("pnpm", ["exec", "tsx", "apps/engine/src/main.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, OCTO_DATA_DIR: dataDir, NODE_NO_WARNINGS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      const reply = JSON.parse(line) as EngineReply;
      const resolve = this.pending.get(reply.id);
      if (!resolve) return;
      this.pending.delete(reply.id);
      resolve(reply);
    });
  }

  request(command: Record<string, unknown>): Promise<EngineReply> {
    const id = randomUUID();
    const payload = JSON.stringify({ v: 1, id, ...command });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${String(command.cmd)}`)), 10_000);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}
