import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: "automations.spec.ts",
  outputDir: "../../../temp/test-results/automations",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1439", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/automations/serve-automations.mjs",
    cwd: "../../..",
    url: "http://127.0.0.1:1439/tests/browser/automations/automations.html",
    reuseExistingServer: false,
    // The fixture is built before it is served; a cold build outlasts Playwright's 60 s default.
    timeout: 300_000,
  },
});
