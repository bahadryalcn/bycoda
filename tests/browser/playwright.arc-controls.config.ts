import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "arc-controls.spec.ts",
  outputDir: "../../temp/test-results/arc-controls",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1442",
    viewport: { width: 1280, height: 800 },
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-arc-controls.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1442/tests/browser/arc-controls.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
