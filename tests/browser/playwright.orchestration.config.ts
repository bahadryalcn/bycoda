import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "orchestration.spec.ts",
  outputDir: "../../temp/test-results/W7-ORCHESTRATION",
  workers: 1,
  timeout: 20000,
  use: { baseURL: "http://127.0.0.1:1465", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-orchestration.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1465/tests/browser/orchestration.html",
    timeout: 180000,
    reuseExistingServer: false,
  },
});
