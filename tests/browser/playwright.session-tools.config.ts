import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["session-tools.e2e.ts"],
  outputDir: "../../temp/test-results/session-tools",
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:1483", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-session-tools.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1483/tests/browser/session-tools.html",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
