import { loadEconomicsOracle } from "@octo/test-fixtures";
import { describe, expect, it } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A08 review, metrics, opportunities", () => {
  it("splits and merges without primary overlap and keeps missing economics unknown", async () => {
    const { engine } = tempEngine();
    startDemo(engine);
    engine.replayCapture();
    await engine.runAnalysis("local_only");
    const created = engine.splitEpisode("episode-A", 300_000);
    expect(created).toBe("episode-A-b");
    engine.mergeEpisodes("episode-A-b", "episode-A");
    const episode = (engine.listEpisodes() as Array<{ id: string; duration_ms: number }>).find(
      (item) => item.id === "episode-A",
    );
    expect(episode?.duration_ms).toBe(1_500_000);

    const economics = loadEconomicsOracle();
    const computed = engine.saveOpportunity("tempo di inserimento", economics.inputs);
    expect(computed.status).toBe("computed");
    if (computed.status === "computed") {
      expect(computed.orePotenziali).toBe(560);
      expect(computed.valoreCapacitaEur).toBe(11760);
      expect(computed.roiAnno1).toBeCloseTo(0.306667, 5);
      expect(computed.paybackMesi).toBeCloseTo(8.22, 2);
    }
    const unknown = engine.saveOpportunity("dati incompleti", { costoOrarioEur: 30 });
    expect(unknown.status).toBe("unknown");

    engine.revokeEvidence("ev-frame-a1");
    engine.enqueueDerive("ev-frame-a1");
    engine.runJobs();
    const evidence = engine.listEvidence() as Array<{ id: string; availability: string }>;
    expect(evidence.find((item) => item.id === "ev-frame-a1")?.availability).toBe("revoked");
    engine.close();
  });
});
