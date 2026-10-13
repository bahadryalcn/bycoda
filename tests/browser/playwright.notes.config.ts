import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "notes.spec.ts",
  outputDir: "../../temp/test-results/notes",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1441",
    viewport: { width: 1560, height: 1015 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-notes.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1441/tests/browser/notes.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
