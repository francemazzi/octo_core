import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { NODE_NO_WARNINGS: "1" },
    fileParallelism: false,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 180_000,
  },
});
