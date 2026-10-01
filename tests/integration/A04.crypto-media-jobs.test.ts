import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OctoError, UnavailableKeyProvider, createEngine } from "@octo/engine";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A04 crypto, media, and jobs", () => {
  it("detects tampering, keeps partial writes invalid, and does not repeat or resurrect work", async () => {
    const blocked = mkdtempSync(join(tmpdir(), "octo-nokey-"));
    const locked = createEngine(blocked, { keyProvider: new UnavailableKeyProvider() });
    expect(() => startDemo(locked)).toThrow(OctoError);
    locked.close();

    const { dir, engine } = tempEngine();
    const started = startDemo(engine);
    const partial = engine.media.begin(started.sessionId, Buffer.from("half"));
    engine.media.abort(partial.assetId);
    const partialRows = engine.listAssets() as Array<{ id: string; state: string }>;
    expect(partialRows.find((row) => row.id === partial.assetId)?.state).toBe("partial");
    expect(engine.listEvidence()).toHaveLength(0);

    engine.replayCapture();
    const asset = (engine.listAssets() as Array<{ id: string; state: string }>).find(
      (row) => row.state === "valid",
    );
    expect(asset).toBeDefined();
    if (!asset) return;
    engine.media.tamper(asset.id);
    expect(() => engine.media.readPlaintext(asset.id)).toThrow(OctoError);

    engine.enqueueOnce("effect-1");
    engine.runJobs();
    engine.enqueueOnce("effect-1");
    engine.runJobs();
    const effects = engine.db
      .prepare("SELECT id FROM audit_events WHERE action = 'job_effect'")
      .all();
    expect(effects).toHaveLength(1);

    const evidence = (engine.listEvidence() as Array<{ id: string }>).at(0);
    expect(evidence).toBeDefined();
    if (!evidence) return;
    engine.revokeEvidence(evidence.id);
    const job = engine.enqueueDerive(evidence.id);
    engine.cancelJob(job.id);
    engine.runJobs();
    const restored = (engine.listEvidence() as Array<{ id: string; availability: string }>).filter(
      (row) => row.id === evidence.id && row.availability === "valid",
    );
    expect(restored).toHaveLength(0);

    const draft = join(dir, "bozza.txt");
    writeFileSync(draft, "bozza");
    engine.protectDraft(draft);
    const exported = await engine.exportSession(join(dir, "export"), "approved");
    expect(exported.version).toBe(1);
    const pressure = engine.applyDiskPressure(0);
    expect(pressure.decision).toBe("pause");
    expect(existsSync(draft)).toBe(false);
    const kept = engine.db
      .prepare("SELECT path FROM protected_reports WHERE approved = 1")
      .all() as Array<{
      path: string;
    }>;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((row) => existsSync(row.path))).toBe(true);
    engine.close();
  });
});
