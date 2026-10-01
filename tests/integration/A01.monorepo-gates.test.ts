import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../scripts/gates/manifest.json";
import { phaseProblems, type PhaseSpec } from "../../scripts/gates/inspect.js";

describe("A01 monorepo gates", () => {
  it("accepts the real A01 phase and rejects only a simulated skip or missing phase", () => {
    expect(existsSync("pnpm-workspace.yaml")).toBe(true);
    expect(existsSync("scripts/gates/manifest.json")).toBe(true);
    const root = process.cwd();
    const a01 = manifest.phases.A01 as PhaseSpec;
    expect(phaseProblems(root, "A01", a01)).toEqual([]);

    const sandbox = mkdtempSync(join(tmpdir(), "octo-a01-"));
    mkdirSync(join(sandbox, "tests"), { recursive: true });
    writeFileSync(join(sandbox, "tests/skip.test.ts"), `it${".skip"}('hidden', () => {});\n`);
    const skipped: PhaseSpec = { track: "automatic", integration: "tests/skip.test.ts", unit: [] };
    expect(phaseProblems(sandbox, "A99", skipped).join(" ")).toContain("skip");
    expect(phaseProblems(root, "A01", a01)).toEqual([]);
    expect(phaseProblems(root, "AMissing", undefined).join(" ")).toContain("missing phase");
  });
});
