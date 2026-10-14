import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Integration tests drive real headless Chromium (runner, MCP server, exported scripts). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
