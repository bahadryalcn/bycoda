import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "global-voice.e2e.ts",
  outputDir: "../../temp/test-results/global-voice",
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:1498",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-settings.mjs tests/browser/vite.global-voice.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:1498/tests/browser/voice-visual-styles.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
