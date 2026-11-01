import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["voice-visual-styles.e2e.ts", "voice-overlay.e2e.ts"],
  outputDir: "../../temp/test-results/voice-visual-styles",
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:1497",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node tests/browser/serve-settings.mjs tests/browser/vite.voice-visual-styles.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:1497/tests/browser/voice-visual-styles.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
