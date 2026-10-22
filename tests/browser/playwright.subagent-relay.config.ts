import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "subagent-relay.spec.ts",
  outputDir: "../../temp/test-results/subagent-relay",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1458",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-subagent-relay.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1458/tests/browser/subagent-relay.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
