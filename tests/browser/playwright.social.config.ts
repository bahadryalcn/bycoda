import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "social.spec.ts",
  outputDir: "../../temp/test-results/social",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:1437", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-social.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1437/tests/browser/social.html",
    reuseExistingServer: false,
  },
});
