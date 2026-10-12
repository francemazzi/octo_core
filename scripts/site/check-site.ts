import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS, assetsByTarget, type SiteRelease } from "../../site/download.js";

/** The landing page is deployable: every build is listed and every local reference exists. */
export function checkSite(root: string): string[] {
  const problems: string[] = [];
  const site = join(root, "site");
  let release: SiteRelease | undefined;
  try {
    release = JSON.parse(readFileSync(join(site, "releases.json"), "utf8")) as SiteRelease;
  } catch (error) {
    problems.push(`releases.json: ${error instanceof Error ? error.message : "unreadable"}`);
  }
  if (release) {
    if (!/^\d+\.\d+\.\d+$/.test(release.version)) problems.push(`version "${release.version}"`);
    const byTarget = assetsByTarget(release);
    for (const target of Object.keys(TARGETS)) {
      if (!byTarget[target as keyof typeof TARGETS]) problems.push(`missing build ${target}`);
    }
    for (const name of ["SHA256SUMS.txt", "LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
      if (!release.assets.some((asset) => asset.name === name)) problems.push(`missing ${name}`);
    }
    for (const asset of release.assets) {
      if (!asset.url.startsWith("https://github.com/"))
        problems.push(`off-GitHub url ${asset.name}`);
    }
  }
  const html = readFileSync(join(site, "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"#?][^"]*)"/g)) {
    const reference = match[1] ?? "";
    if (/^(https?:|mailto:)/.test(reference)) {
      if (/^http:/.test(reference)) problems.push(`insecure link ${reference}`);
      continue;
    }
    if (!existsSync(join(site, reference))) problems.push(`missing file ${reference}`);
  }
  if (/<script[^>]+src="https?:/.test(html)) problems.push("third-party script");
  return problems;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const problems = checkSite(process.cwd());
  if (problems.length > 0) {
    process.stderr.write(`site: ${problems.join("; ")}\n`);
    process.exit(1);
  }
  process.stdout.write("site: ok\n");
}
