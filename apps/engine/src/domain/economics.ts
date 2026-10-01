import type { EconomicsInput } from "@octo/contracts";

const INPUT_FIELDS = [
  "volumeAnnuo",
  "quotaCoperta",
  "tempoPrimaMin",
  "tempoDopoMin",
  "costoOrarioEur",
  "fattoreUtilizzoCapacita",
  "investimentoEur",
  "costiRicorrentiAnnuiEur",
] as const satisfies readonly (keyof EconomicsInput)[];

export type EconomicsComputation =
  | {
      status: "computed";
      orePotenziali: number;
      valoreCapacitaEur: number;
      beneficioNettoAnnuoEur: number;
      roiAnno1: number;
      paybackMesi: number | "non_raggiunto";
    }
  | { status: "unknown"; missing: string[] };

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function computeEconomics(input: Partial<EconomicsInput>): EconomicsComputation {
  const missing = INPUT_FIELDS.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || Number.isNaN(value);
  });
  if (missing.length > 0) return { status: "unknown", missing: [...missing] };

  const full = input as EconomicsInput;
  const orePotenziali = round6(
    (full.volumeAnnuo * full.quotaCoperta * (full.tempoPrimaMin - full.tempoDopoMin)) / 60,
  );
  const valoreCapacitaEur = round6(
    orePotenziali * full.costoOrarioEur * full.fattoreUtilizzoCapacita,
  );
  const beneficioNettoAnnuoEur = round6(valoreCapacitaEur - full.costiRicorrentiAnnuiEur);
  const denominator = full.investimentoEur + full.costiRicorrentiAnnuiEur;
  if (denominator === 0) return { status: "unknown", missing: ["denominator"] };

  const roiAnno1 = round6(
    (valoreCapacitaEur - full.investimentoEur - full.costiRicorrentiAnnuiEur) / denominator,
  );
  const monthlyNet = beneficioNettoAnnuoEur / 12;
  const paybackMesi = monthlyNet <= 0 ? "non_raggiunto" : round6(full.investimentoEur / monthlyNet);

  return {
    status: "computed",
    orePotenziali,
    valoreCapacitaEur,
    beneficioNettoAnnuoEur,
    roiAnno1,
    paybackMesi,
  };
}
