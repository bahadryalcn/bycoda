import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "session-deletion.spec.ts",
  outputDir: "../../temp/test-results/session-deletion",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1449",
    browserName: "chromium",
    viewport: { width: 390, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/serve-session-deletion.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1449/tests/browser/session-deletion.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
