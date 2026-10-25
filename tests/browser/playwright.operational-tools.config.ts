import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "operational-tools.spec.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../../temp/test-results/operational-tools",
  use: {
    baseURL: "http://127.0.0.1:4198",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/serve-settings.mjs tests/browser/vite.operational-tools.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:4198/tests/browser/operational-tools.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
