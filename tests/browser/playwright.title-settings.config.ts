import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "title-settings.e2e.ts",
  outputDir: "../../temp/verification/title-regeneration/settings-test-results",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1479",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "pnpm exec vite --config tests/browser/vite.title-settings.config.ts --host 127.0.0.1 --port 1479 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:1479/title-settings.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
