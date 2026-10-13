import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { NODE_NO_WARNINGS: "1" },
    fileParallelism: false,
    include: ["**/*.{test,unit.test}.ts"],
    // The gates run the integration files too: same budget as vitest.integration.config.ts.
    testTimeout: 180_000,
  },
});
