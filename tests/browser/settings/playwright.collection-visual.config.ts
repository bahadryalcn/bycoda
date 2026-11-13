import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "..",
  testMatch: "settings-collection-visual.e2e.ts",
  outputDir: "../../../temp/test-results/settings-collection-visual",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:1477",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node tests/browser/settings/serve-settings.mjs tests/browser/settings/vite.collection-visual.config.ts",
    cwd: "../../..",
    url: "http://127.0.0.1:1477/tests/browser/settings/settings.html",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
