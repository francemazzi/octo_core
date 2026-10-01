import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PhaseSpec = {
  track: "automatic" | "hardware" | "human";
  integration: string;
  unit: string[];
  evidenceRequired?: boolean;
};

const SKIP = /\b(?:it|test|describe)\.skip\b|\b(?:xit|xtest)\s*\(/;

export function phaseProblems(root: string, phase: string, spec: PhaseSpec | undefined): string[] {
  if (!spec) return [`missing phase ${phase}`];
  const problems: string[] = [];
  problems.push(...fileProblems(root, spec.integration));
  for (const unit of spec.unit) problems.push(...fileProblems(root, unit));
  if (spec.evidenceRequired && !existsSync(join(root, "docs", "testing", `${phase}.md`))) {
    problems.push(`missing evidence docs/testing/${phase}.md`);
  }
  return problems;
}

function fileProblems(root: string, relative: string): string[] {
  const file = join(root, relative);
  if (!existsSync(file)) return [`missing ${relative}`];
  const text = readFileSync(file, "utf8");
  if (SKIP.test(text)) return [`skip in ${relative}`];
  return [];
}
