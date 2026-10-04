import { createRequire } from "node:module";
import type { Plugin } from "esbuild";

/**
 * Resolves bare imports with Node's own algorithm. esbuild would otherwise honour any Yarn PnP
 * manifest (`.pnp.cjs`) it finds in a parent directory of the checkout and refuse workspace
 * packages. `anchor` is the package.json to resolve source imports from (with fallback to it).
 */
export function nodeResolvePlugin(options: { external?: string[]; anchor?: string } = {}): Plugin {
  const external = new Set(options.external ?? []);
  const fromAnchor = options.anchor ? createRequire(options.anchor) : undefined;

  function resolve(specifier: string, importer: string): string {
    const fromSource = !importer.includes("node_modules") && !importer.endsWith(".js");
    const origin = options.anchor && fromSource ? options.anchor : importer;
    try {
      return createRequire(origin).resolve(specifier);
    } catch (error) {
      if (!fromAnchor) throw error;
      return fromAnchor.resolve(specifier);
    }
  }

  return {
    name: "node-resolve",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true }));
      pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
        external.has(args.path)
          ? { path: args.path, external: true }
          : { path: resolve(args.path, args.importer) },
      );
    },
  };
}
