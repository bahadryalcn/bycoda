import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "..",
  testMatch: "skill-catalog.e2e.ts",
  outputDir: "../../../temp/test-results/skill-catalog",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1517", trace: "retain-on-failure" },
  webServer: {
    command:
      "node tests/browser/settings/serve-settings.mjs tests/browser/skills/vite.skill-catalog.config.ts",
    cwd: "../../..",
    url: "http://127.0.0.1:1517/tests/browser/skills/skill-catalog.html",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
