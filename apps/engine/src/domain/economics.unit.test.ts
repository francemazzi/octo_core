import { describe, expect, it } from "vitest";
import { loadEconomicsOracle } from "@octo/test-fixtures";
import { computeEconomics } from "./economics.js";

describe("computeEconomics", () => {
  it("matches the reference oracle", () => {
    const oracle = loadEconomicsOracle();
    const result = computeEconomics(oracle.inputs);
    expect(result).toEqual({
      status: "computed",
      orePotenziali: oracle.expected.orePotenziali,
      valoreCapacitaEur: oracle.expected.valoreCapacitaEur,
      beneficioNettoAnnuoEur: oracle.expected.beneficioNettoAnnuoEur,
      roiAnno1: oracle.expected.roiAnno1,
      paybackMesi: oracle.expected.paybackMesi,
    });
  });

  it("stays unknown when an input is missing", () => {
    const result = computeEconomics({ costoOrarioEur: 30 });
    expect(result.status).toBe("unknown");
    if (result.status === "unknown") {
      expect(result.missing).toContain("volumeAnnuo");
    }
  });

  it("reports payback as non_raggiunto when monthly net is not positive", () => {
    const result = computeEconomics({
      volumeAnnuo: 0,
      quotaCoperta: 0.7,
      tempoPrimaMin: 6,
      tempoDopoMin: 2,
      costoOrarioEur: 30,
      fattoreUtilizzoCapacita: 0.7,
      investimentoEur: 6000,
      costiRicorrentiAnnuiEur: 3000,
    });
    expect(result.status).toBe("computed");
    if (result.status === "computed") expect(result.paybackMesi).toBe("non_raggiunto");
  });
});
