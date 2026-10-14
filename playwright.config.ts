import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real app. Set E2E_BASE_URL to test a running server (for
 * example a preview deployment); otherwise the app is started on port 3100.
 */
const external = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: process.env.CI ? `npx next start -p ${port}` : `npx next dev -p ${port}`,
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
