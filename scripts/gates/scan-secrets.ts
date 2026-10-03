import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: "github-token", pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "openrouter-key", pattern: /sk-or-v1-[A-Za-z0-9]+/ },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "out", ".vite", "coverage", "dist-win"]);

export type SecretHit = { file: string; name: string };

export function findSecrets(root: string): SecretHit[] {
  const hits: SecretHit[] = [];
  walk(root, root, hits);
  return hits;
}

function walk(root: string, dir: string, hits: SecretHit[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    // Local env files hold the developer's own keys and are gitignored; they never ship.
    if (entry === ".env" || entry.startsWith(".env.")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(root, full, hits);
      continue;
    }
    if (stat.size > 1_000_000) continue;
    if (!/\.(?:ts|tsx|js|mjs|cjs|json|md|yml|yaml|env|txt)$/.test(entry)) continue;
    const text = readFileSync(full, "utf8");
    for (const rule of PATTERNS) {
      if (rule.pattern.test(text)) hits.push({ file: relative(root, full), name: rule.name });
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const hits = findSecrets(process.cwd());
  if (hits.length > 0) {
    process.stderr.write(`${hits.map((hit) => `${hit.name} ${hit.file}`).join("\n")}\n`);
    process.exit(1);
  }
}
