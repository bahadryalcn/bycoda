import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "automations.spec.ts",
  outputDir: "../../temp/test-results/automations",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:1458", headless: true, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-automations.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1458/tests/browser/automations.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
