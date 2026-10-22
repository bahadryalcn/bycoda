import { defineConfig } from "@playwright/test";
import settings from "./playwright.settings.config";

export default defineConfig({
  ...settings,
  testMatch: ["connections.e2e.ts"],
  outputDir: "../../temp/test-results/connections",
  use: { ...settings.use, baseURL: "http://127.0.0.1:18438" },
  webServer: {
    command: "node tests/browser/serve-settings.mjs tests/browser/vite.connections.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:18438/tests/browser/settings.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
