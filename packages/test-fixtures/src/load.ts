import { readFileSync } from "node:fs";
import {
  economicsOracleSchema,
  sessionOracleSchema,
  type EconomicsOracle,
  type SessionOracle,
} from "@octo/contracts";

function readJson(name: string): unknown {
  const url = new URL(`../${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

export function loadSessionOracle(): SessionOracle {
  return sessionOracleSchema.parse(readJson("session-oracle.json"));
}

export function loadEconomicsOracle(): EconomicsOracle {
  return economicsOracleSchema.parse(readJson("economics-oracle.json"));
}

export function loadModelOutputFixture(): unknown {
  return readJson("model-output.json");
}
