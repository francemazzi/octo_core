import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const payload = [
  readFileSync(join(root, "package.json")),
  readFileSync(join(root, "apps/desktop/package.json")),
  readFileSync(join(root, "apps/engine/src/main.ts")),
];
const hash = createHash("sha256").update(Buffer.concat(payload)).digest("hex");
const out = join(root, "dist-win");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "UNSIGNED.txt"), "dev package, not Authenticode signed\n");
writeFileSync(join(out, "build-hash.txt"), `${hash}\n`);
process.stdout.write(`${hash}\n`);
