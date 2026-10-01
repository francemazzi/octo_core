import { build } from "esbuild";
import { build as buildRenderer } from "vite";
import rendererConfig from "./vite.renderer.config.js";

await build({
  entryPoints: ["src/main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  external: ["electron"],
});

await build({
  entryPoints: ["src/preload/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});

await buildRenderer({ ...rendererConfig, configFile: false });
