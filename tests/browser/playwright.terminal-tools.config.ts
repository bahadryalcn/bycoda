import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "terminal-tools.e2e.ts",
  outputDir: "../../temp/test-results/terminal-tools",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1457", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-terminal-tools.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1457/tests/browser/terminal-tools.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
