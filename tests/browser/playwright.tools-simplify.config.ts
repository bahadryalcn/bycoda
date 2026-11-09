import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "tools-simplify.e2e.ts",
  outputDir: "../../temp/test-results/tools-simplify",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:1438",
    viewport: { width: 480, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-host-tools.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1438/tests/browser/host-tools.html",
    reuseExistingServer: false,
  },
});
