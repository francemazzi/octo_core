import { loadEconomicsOracle, loadSessionOracle } from "@octo/test-fixtures";
import { computeEconomics, naiveIntervalSumMs, summarizeAssignedTime } from "@octo/engine";
import { describe, expect, it } from "vitest";

describe("A00 oracle fixtures", () => {
  it("unions monitor time and matches the economics oracle", () => {
    const session = loadSessionOracle();
    const authorized = new Set(
      session.session.sources.filter((source) => source.authorized).map((source) => source.id),
    );
    const summary = summarizeAssignedTime(
      [...session.stretches, ...session.secondaryLabels],
      authorized,
    );
    expect(summary.byEpisodeMs["episode-A"]).toBe(session.expected.episodeDurationMs["episode-A"]);
    expect(summary.byEpisodeMs["episode-B"]).toBe(session.expected.episodeDurationMs["episode-B"]);
    expect(summary.byEpisodeMs["episode-X"]).toBeUndefined();
    expect(summary.declaredWaitMs).toBe(session.expected.declaredWaitMs);
    expect(summary.unknownMs).toBe(session.expected.unknownMs);
    expect(summary.humanTotalMs).toBe(session.expected.humanTotalMs);
    expect(summary.humanTotalMs).toBeLessThan(session.expected.naiveAuthorizedIntervalSumMs);
    expect(naiveIntervalSumMs(session.stretches, authorized)).toBe(
      session.expected.naiveAuthorizedIntervalSumMs,
    );

    const economics = loadEconomicsOracle();
    const result = computeEconomics(economics.inputs);
    expect(result.status).toBe("computed");
    if (result.status !== "computed") return;
    expect(result.orePotenziali).toBe(560);
    expect(result.valoreCapacitaEur).toBe(11760);
    expect(result.beneficioNettoAnnuoEur).toBe(8760);
    expect(result.roiAnno1).toBeCloseTo(0.306667, 5);
    expect(result.paybackMesi).toBeCloseTo(8.22, 2);
    expect(result).toMatchObject(economics.expected);
  });
});
