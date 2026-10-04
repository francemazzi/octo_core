import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createEngine, diagnosticGuide } from "@octo/engine";
import { EngineProcess } from "../helpers/process.js";
import { startDemo, tempEngine } from "../helpers/engine.js";

const MARKER = "SYNTHETIC_SECRET_MARKER";

function treeHasMarker(dir: string): boolean {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (treeHasMarker(full)) return true;
      continue;
    }
    if (stat.size > 2_000_000) continue;
    if (readFileSync(full).includes(Buffer.from(MARKER))) return true;
  }
  return false;
}

describe("A12 simulated hardening", () => {
  it("pauses on a full disk, queues offline work, and leaves no marker after delete", async () => {
    const { dir, engine } = tempEngine();
    startDemo(engine);
    const exported = await engine.exportSession(join(dir, "out"), "approved");
    expect(exported.version).toBe(1);
    const pressure = engine.applyDiskPressure(0);
    expect(pressure.decision).toBe("pause");
    const approved = engine.db
      .prepare("SELECT path FROM protected_reports WHERE approved = 1")
      .all() as Array<{
      path: string;
    }>;
    expect(approved.every((row) => statSync(row.path).isFile())).toBe(true);

    engine.setOffline(true);
    engine.enqueueRemote();
    const remote = engine.runJobs();
    expect(remote?.status === "queued" || remote?.status === "failed").toBe(true);
    expect(engine.networkAudits()).toHaveLength(0);

    writeFileSync(join(dir, "media", MARKER), MARKER);
    engine.replayCapture();
    expect(treeHasMarker(dir)).toBe(true);
    engine.deletePerimeter();
    expect(treeHasMarker(dir)).toBe(false);
    engine.enqueueDerive("ev-frame-a1");
    engine.runJobs();
    expect(engine.listEvidence()).toHaveLength(0);
    engine.writeLog("frame data:image/png;base64,AAAA SYNTHETIC_SECRET_MARKER");
    expect(engine.readLog()).not.toContain(MARKER);
    expect(engine.readLog()).toContain("[pixels]");
    expect(diagnosticGuide()).toContain("Stop");
    engine.close();

    const liveDir = mkdtempSync(join(tmpdir(), "octo-kill-"));
    const killed = new EngineProcess(liveDir);
    const hello = await killed.request({
      cmd: "session.start",
      projectId: "oracle-project",
      operatorPseudonym: "op-demo",
      sourceIds: ["mon-1"],
      purpose: "kill",
    });
    expect(hello.ok).toBe(true);
    killed.child.kill("SIGKILL");
    await new Promise((resolve) => killed.child.once("exit", resolve));
    const recovered = createEngine(liveDir);
    const sessions = recovered.db.prepare("SELECT id FROM sessions").all();
    expect(sessions).toHaveLength(1);
    recovered.close();

    const restarted = new EngineProcess(liveDir);
    const stopped = await restarted.request({ cmd: "session.stop" });
    expect(stopped.ok).toBe(true);
    const state = await restarted.request({ cmd: "session.state" });
    expect(state.ok).toBe(true);
    await restarted.request({ cmd: "shutdown" });
    const reopened = createEngine(liveDir);
    expect(reopened.db.prepare("SELECT id FROM clock_epochs").all()).toHaveLength(2);
    reopened.close();
    await restarted.close();

    execFileSync("pnpm", ["exec", "tsx", "scripts/package-win.ts"], { cwd: process.cwd() });
    const hash = readFileSync(join(process.cwd(), "dist-win", "build-hash.txt"), "utf8").trim();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(process.cwd(), "dist-win", "UNSIGNED.txt"), "utf8")).toContain(
      "not Authenticode",
    );

    execFileSync("pnpm", ["--filter", "@octo/desktop", "bundle-engine"], { cwd: process.cwd() });
    const bundledDir = mkdtempSync(join(tmpdir(), "octo-bundled-"));
    const replies = execFileSync("node", ["apps/desktop/dist/engine.mjs"], {
      cwd: process.cwd(),
      input: `${JSON.stringify({ v: 1, id: "h", cmd: "handshake", clientVersion: 1 })}\n${JSON.stringify({ v: 1, id: "bye", cmd: "shutdown" })}\n`,
      env: { ...process.env, OCTO_DATA_DIR: bundledDir, OCTO_MODEL: "off", NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
    });
    expect(replies).toContain('"status":"bye"');
    const bundled = new DatabaseSync(join(bundledDir, "octo.db"));
    expect(bundled.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toEqual([
      { id: "001" },
      { id: "002" },
    ]);
    bundled.close();
  }, 120_000);
});
