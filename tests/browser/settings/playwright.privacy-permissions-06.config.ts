import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "privacy-permissions-06.e2e.ts",
  workers: 1,
  timeout: 30_000,
  outputDir: "../../../temp/test-results/privacy-permissions-06",
  use: { baseURL: "http://127.0.0.1:1476", viewport: { width: 1280, height: 900 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node tests/browser/settings/serve-settings.mjs tests/browser/settings/vite.privacy-permissions-06.config.ts",
    cwd: "../../..",
    url: "http://127.0.0.1:1476/tests/browser/settings/privacy-permissions-06.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
