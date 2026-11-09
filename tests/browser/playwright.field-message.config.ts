import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "field-message.spec.ts",
  outputDir: "../../temp/test-results/field-message",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1459",
    viewport: { width: 1280, height: 800 },
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-field-message.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1459/tests/browser/field-message.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
