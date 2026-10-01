import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { phaseProblems, type PhaseSpec } from "./inspect.js";

type Manifest = {
  tracks: Record<string, { status: string }>;
  phases: Record<string, PhaseSpec>;
};

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
) as Manifest;

const args = process.argv.slice(2);
const release = args.includes("--release");
const all = args.includes("--all");
const phase = args.find((arg) => /^A\d{2}$/.test(arg));

if (release) {
  const pending = Object.entries(manifest.tracks)
    .filter(([, track]) => track.status === "pending")
    .map(([name]) => name);
  if (pending.length > 0) {
    process.stderr.write(`gate:release blocked, pending: ${pending.join(", ")}\n`);
    process.exit(1);
  }
}

const selected = all ? Object.keys(manifest.phases) : phase ? [phase] : [];
if (selected.length === 0) {
  process.stderr.write("usage: pnpm gate Axx | pnpm gate:all | pnpm gate:release\n");
  process.exit(1);
}

const files: string[] = [];
for (const name of selected) {
  const problems = phaseProblems(process.cwd(), name, manifest.phases[name]);
  if (problems.length > 0) {
    process.stderr.write(`${name}: ${problems.join("; ")}\n`);
    process.exit(1);
  }
  const spec = manifest.phases[name];
  if (!spec) continue;
  files.push(spec.integration, ...spec.unit);
}

const child = spawn("pnpm", ["exec", "vitest", "run", "--config", "vitest.config.ts", ...files], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
