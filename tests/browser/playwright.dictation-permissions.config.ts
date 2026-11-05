import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "dictation-permissions.e2e.ts",
  outputDir: "../../temp/test-results/dictation-permissions",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1513",
    viewport: { width: 1280, height: 1100 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer:
    process.env.BYCODA_DICTATION_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command:
            "node tests/browser/serve-settings.mjs tests/browser/vite.dictation-permissions.config.ts",
          cwd: "../..",
          url: "http://127.0.0.1:1513/tests/browser/dictation-permissions.html",
          reuseExistingServer: false,
          timeout: 120_000,
        },
});
