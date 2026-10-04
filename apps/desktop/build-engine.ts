import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { nodeResolvePlugin } from "./build-resolve.js";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(desktopRoot, "..", "..");

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

const fixtures: Record<string, string> = {
  "session-oracle.json": readRepo("packages/test-fixtures/session-oracle.json"),
  "economics-oracle.json": readRepo("packages/test-fixtures/economics-oracle.json"),
  "model-output.json": readRepo("packages/test-fixtures/model-output.json"),
};

const migrationsDir = "apps/engine/src/storage/migrations";
const migrations: Record<string, string> = Object.fromEntries(
  readdirSync(join(repoRoot, migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => [name, readRepo(`${migrationsDir}/${name}`)]),
);
const nodeResolve = nodeResolvePlugin({ anchor: join(repoRoot, "apps/engine/package.json") });

const inlineAssets: Plugin = {
  name: "inline-assets",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /storage\/db\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const needle = 'readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8")';
      if (!source.includes(needle)) throw new Error(`migration read not found in ${args.path}`);
      const listed = [...source.matchAll(/"(\d{3}_[a-z_]+\.sql)"/g)].map((match) => match[1]);
      const missing = listed.filter((name) => name && migrations[name] === undefined);
      if (listed.length === 0 || missing.length > 0) {
        throw new Error(`migrations not bundled: ${missing.join(", ") || "none listed"}`);
      }
      const replacement = `((files: Record<string, string>) => {
    const sql = files[file];
    if (sql === undefined) throw new Error("missing migration " + file);
    return sql;
  })(${JSON.stringify(migrations)})`;
      return { contents: source.replace(needle, replacement), loader: "ts" };
    });
    pluginBuild.onLoad({ filter: /test-fixtures\/src\/load\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const needle =
        'const url = new URL(`../${name}`, import.meta.url);\n  return JSON.parse(readFileSync(url, "utf8")) as unknown;';
      if (!source.includes(needle)) throw new Error(`fixture read not found in ${args.path}`);
      const replacement = `const files: Record<string, string> = ${JSON.stringify(fixtures)};
  const raw = files[name];
  if (raw === undefined) throw new Error("missing fixture " + name);
  return JSON.parse(raw) as unknown;`;
      return { contents: source.replace(needle, replacement), loader: "ts" };
    });
  },
};

await build({
  entryPoints: [join(repoRoot, "apps/engine/src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(desktopRoot, "dist/engine.mjs"),
  plugins: [nodeResolve, inlineAssets],
  banner: {
    js: 'import { createRequire as __octoCreateRequire } from "node:module"; const require = __octoCreateRequire(import.meta.url);',
  },
});
