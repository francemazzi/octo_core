import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { external: ["electron"] },
    lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" },
    outDir: "dist",
    emptyOutDir: false,
  },
});
