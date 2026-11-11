import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "..",
  testMatch: "termius-import.spec.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../../../temp/test-results/termius",
  use: { baseURL: "http://127.0.0.1:18521", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command:
      "node tests/browser/settings/serve-settings.mjs tests/browser/terminal/vite.termius.config.ts",
    cwd: "../../..",
    url: "http://127.0.0.1:18521/tests/browser/terminal/termius-import.html",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
