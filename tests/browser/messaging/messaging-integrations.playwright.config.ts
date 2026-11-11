import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: "messaging-integrations.spec.ts",
  outputDir: "../../../temp/test-results/browser-messaging-integrations",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:15761", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/messaging/serve-messaging-integrations.mjs",
    cwd: "../../..",
    url: "http://127.0.0.1:15761/tests/browser/messaging/messaging-integrations.html",
    reuseExistingServer: false,
    // The fixture is built before it is served; a cold build outlasts Playwright's 60 s default.
    timeout: 300_000,
  },
});
