import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phaseProblems, type PhaseSpec } from "./inspect.js";

describe("gate inspection", () => {
  it("fails a missing phase and a skipped test without affecting another phase", () => {
    const root = mkdtempSync(join(tmpdir(), "octo-gate-"));
    mkdirSync(join(root, "tests"), { recursive: true });
    const ok = "tests/ok.test.ts";
    const skipped = "tests/skip.test.ts";
    writeFileSync(join(root, ok), "it('works', () => {});\n");
    writeFileSync(join(root, skipped), `it${".skip"}('nope', () => {});\n`);
    const good: PhaseSpec = { track: "automatic", integration: ok, unit: [] };
    const bad: PhaseSpec = { track: "automatic", integration: skipped, unit: [] };
    expect(phaseProblems(root, "A01", good)).toEqual([]);
    expect(phaseProblems(root, "A99", undefined).join(" ")).toContain("missing phase");
    expect(phaseProblems(root, "A99", bad).join(" ")).toContain("skip");
  });
});
