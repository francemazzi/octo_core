import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  licenseProblems,
  parsePnpmLicenses,
  renderNotices,
  type LicensedPackage,
} from "./licenses.js";

export type LicenseCheckOptions = {
  root: string;
  /** Destination of THIRD-PARTY-NOTICES.txt; omitted when only checking. */
  out?: string;
  /** Seam for tests: returns the JSON printed by `pnpm licenses list --json --prod`. */
  list?: (root: string) => string;
};

export type LicenseReport = { packages: LicensedPackage[]; problems: string[] };

function pnpmLicensesJson(root: string): string {
  return execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Checks every production dependency and, when clean and `out` is set, writes the notices. */
export function runLicenseCheck(options: LicenseCheckOptions): LicenseReport {
  const packages = parsePnpmLicenses((options.list ?? pnpmLicensesJson)(options.root));
  const problems = licenseProblems(packages);
  if (problems.length === 0 && options.out) {
    const target = resolve(options.root, options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderNotices(packages));
  }
  return { packages, problems };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (outIndex >= 0 && !out) {
    process.stderr.write("usage: pnpm check:licenses [--out <path>]\n");
    process.exit(1);
  }
  const report = runLicenseCheck({ root: process.cwd(), out });
  if (report.problems.length > 0) {
    process.stderr.write(`licenses outside the allowlist:\n${report.problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `licenses: ${report.packages.length} production packages allowed${out ? `, notices in ${out}` : ""}\n`,
  );
}
