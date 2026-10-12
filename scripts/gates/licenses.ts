/**
 * License policy for production dependencies of a GPL-3.0-or-later program.
 * Pure functions: parsing of `pnpm licenses list --json`, SPDX expression evaluation
 * against the allowlist and rendering of THIRD-PARTY-NOTICES.txt.
 */

export type LicensedPackage = {
  name: string;
  versions: string[];
  license: string;
  author?: string;
  homepage?: string;
};

/** SPDX identifiers whose terms can be combined with GPL-3.0-or-later. */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set(
  [
    "MIT",
    "MIT-0",
    "ISC",
    "0BSD",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
    "CC0-1.0",
    "Unlicense",
    "BlueOak-1.0.0",
    "Python-2.0",
    "PSF-2.0",
    "MPL-2.0",
    "LGPL-2.1-or-later",
    "LGPL-2.1+",
    "LGPL-3.0",
    "LGPL-3.0-only",
    "LGPL-3.0-or-later",
    "GPL-2.0-or-later",
    "GPL-2.0+",
    "GPL-3.0",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "CC-BY-4.0",
    "W3C",
    "Zlib",
  ].map((id) => id.toLowerCase()),
);

type PnpmLicenseEntry = {
  name: string;
  versions?: string[];
  license?: string;
  author?: string;
  homepage?: string;
};

/** Flattens the `{ "<license>": [entries] }` shape printed by pnpm 10. */
export function parsePnpmLicenses(json: string): LicensedPackage[] {
  const parsed = JSON.parse(json) as Record<string, PnpmLicenseEntry[]>;
  const packages: LicensedPackage[] = [];
  for (const [group, entries] of Object.entries(parsed)) {
    for (const entry of entries) {
      packages.push({
        name: entry.name,
        versions: [...(entry.versions ?? [])].sort(),
        license: (entry.license ?? group).trim(),
        ...(entry.author ? { author: entry.author } : {}),
        ...(entry.homepage ? { homepage: entry.homepage } : {}),
      });
    }
  }
  return sortPackages(packages);
}

function sortPackages(packages: LicensedPackage[]): LicensedPackage[] {
  return [...packages].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

type Parser = { tokens: string[]; index: number };

function tokenize(expression: string): string[] {
  return expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
}

function peek(parser: Parser): string | undefined {
  return parser.tokens[parser.index];
}

function take(parser: Parser): string {
  const token = parser.tokens[parser.index];
  if (token === undefined) throw new Error("unexpected end of SPDX expression");
  parser.index += 1;
  return token;
}

function isKeyword(token: string | undefined, keyword: string): boolean {
  return token !== undefined && token.toUpperCase() === keyword;
}

function parseOr(parser: Parser, allowed: ReadonlySet<string>): boolean {
  let result = parseAnd(parser, allowed);
  while (isKeyword(peek(parser), "OR")) {
    take(parser);
    const right = parseAnd(parser, allowed);
    result = result || right;
  }
  return result;
}

function parseAnd(parser: Parser, allowed: ReadonlySet<string>): boolean {
  let result = parsePrimary(parser, allowed);
  while (isKeyword(peek(parser), "AND")) {
    take(parser);
    const right = parsePrimary(parser, allowed);
    result = result && right;
  }
  return result;
}

function parsePrimary(parser: Parser, allowed: ReadonlySet<string>): boolean {
  const token = take(parser);
  if (token === "(") {
    const inner = parseOr(parser, allowed);
    if (take(parser) !== ")") throw new Error("unbalanced parenthesis in SPDX expression");
    return inner;
  }
  if (token === ")" || isKeyword(token, "AND") || isKeyword(token, "OR")) {
    throw new Error(`unexpected token ${token} in SPDX expression`);
  }
  let id = token;
  // "X WITH exception" changes the terms: only an explicit allowlist entry accepts it.
  if (isKeyword(peek(parser), "WITH")) {
    take(parser);
    id = `${id} WITH ${take(parser)}`;
  }
  return allowed.has(id.toLowerCase());
}

/**
 * True when the SPDX expression is compatible: an OR passes if any branch passes,
 * an AND only if every branch passes. Unknown or malformed expressions fail.
 */
export function licenseAllowed(
  expression: string,
  allowed: ReadonlySet<string> = ALLOWED_LICENSES,
): boolean {
  const parser: Parser = { tokens: tokenize(expression), index: 0 };
  if (parser.tokens.length === 0) return false;
  try {
    const result = parseOr(parser, allowed);
    return result && parser.index === parser.tokens.length;
  } catch {
    return false;
  }
}

/** One line per package whose license is missing, unknown or outside the allowlist. */
export function licenseProblems(
  packages: LicensedPackage[],
  allowed: ReadonlySet<string> = ALLOWED_LICENSES,
): string[] {
  return sortPackages(packages)
    .filter((pkg) => !licenseAllowed(pkg.license, allowed))
    .map((pkg) => `${pkg.name} ${pkg.versions.join(", ")}: ${pkg.license || "missing license"}`);
}

/** Deterministic notices file: sorted, one line per package, no timestamps. */
export function renderNotices(packages: LicensedPackage[]): string {
  const lines = sortPackages(packages).map((pkg) => {
    const origin = pkg.author ?? pkg.homepage ?? "";
    const tail = origin ? ` — ${origin}` : "";
    return `${pkg.name} ${pkg.versions.join(", ")} — ${pkg.license}${tail}`;
  });
  return [
    "Octo Core — third-party notices",
    "Production dependencies bundled with the application, generated by `pnpm check:licenses`.",
    "Octo Core itself is licensed under GPL-3.0-or-later (see LICENSE).",
    "",
    ...lines,
    "",
  ].join("\n");
}
