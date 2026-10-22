import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["usage-budgets.spec.ts", "usage-analytics.spec.ts"],
  outputDir: "../../temp/test-results/usage-budgets",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1468",
    viewport: { width: 1280, height: 800 },
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-usage-budgets.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1468/tests/browser/usage-budgets.html",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
