import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { external: ["electron"] },
    lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    outDir: "dist",
    emptyOutDir: false,
  },
});
