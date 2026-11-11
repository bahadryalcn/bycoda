import { defineConfig } from "@playwright/test";
import settings from "../settings/playwright.settings.config";

export default defineConfig({
  ...settings,
  testMatch: ["connections.e2e.ts"],
  outputDir: "../../../temp/test-results/connections",
  use: { ...settings.use, baseURL: "http://127.0.0.1:18438" },
  webServer: {
    command:
      "node tests/browser/settings/serve-settings.mjs tests/browser/connections/vite.connections.config.ts",
    cwd: "../../..",
    url: "http://127.0.0.1:18438/tests/browser/settings/settings.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
