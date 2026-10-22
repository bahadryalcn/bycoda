import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "browser-annotation.e2e.ts",
  outputDir: "../../temp/test-results/browser-annotation",
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:1444", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-browser-annotation.mjs",
    cwd: "../..",
    timeout: 180000,
    url: "http://127.0.0.1:1444/tests/browser/browser-annotation.html",
    reuseExistingServer: false,
  },
});
