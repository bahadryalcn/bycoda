import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "assistant-room.e2e.ts",
  outputDir: "../../temp/test-results/assistant-room",
  workers: 1,
  timeout: 120000,
  use: { baseURL: "http://127.0.0.1:15632", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node tests/browser/serve-settings.mjs tests/browser/vite.assistant-room.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:15632/tests/browser/assistant-room.html",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
