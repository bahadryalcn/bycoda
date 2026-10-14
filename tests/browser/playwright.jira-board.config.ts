import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "jira-board.spec.ts",
  outputDir: "../../temp/test-results/jira-board",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1443",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-jira-board.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1443/tests/browser/jira-board.html",
    reuseExistingServer: false,
  },
});
