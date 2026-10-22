import { defineConfig, devices } from "@playwright/test";

import { baseUrl } from "./support/env";

// Authenticated staging workflows (UX-RB release safety). Never production: see
// support/env.ts. Credentials come only from the environment (e2e/README.md).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL: baseUrl(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Field screens on a phone (390 x 844, touch).
    { name: "phone", grep: /@field/, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
