import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "settings.e2e.ts",
    "settings-subviews.e2e.ts",
    "settings-skills.e2e.ts",
    "settings-notifications.e2e.ts",
  ],
  outputDir: "../../temp/test-results/settings",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1468",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-settings.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1468/tests/browser/settings.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
