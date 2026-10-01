import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

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

const migrationSql = readRepo("apps/engine/src/storage/migrations/001_init.sql");
const requireFromEngine = createRequire(join(repoRoot, "apps/engine/package.json"));

function resolvePackage(specifier: string, importer: string): string {
  const origin =
    importer.includes("node_modules") || importer.endsWith(".js")
      ? importer
      : join(repoRoot, "apps/engine/package.json");
  try {
    return createRequire(origin).resolve(specifier);
  } catch {
    return requireFromEngine.resolve(specifier);
  }
}

const nodeResolve: Plugin = {
  name: "node-resolve",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => ({
      path: resolvePackage(args.path, args.importer),
    }));
  },
};

const inlineAssets: Plugin = {
  name: "inline-assets",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /storage\/db\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const needle = 'readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8")';
      if (!source.includes(needle)) throw new Error(`migration read not found in ${args.path}`);
      return {
        contents: source.replace(needle, JSON.stringify(migrationSql)),
        loader: "ts",
      };
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
