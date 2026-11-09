import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["assistant-settings.e2e.ts", "assistant-settings-safety.e2e.ts"],
  outputDir: "../../temp/test-results/assistant-settings",
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:15645", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node tests/browser/serve-settings.mjs tests/browser/vite.assistant-settings.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:15645/tests/browser/assistant-room.html",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
