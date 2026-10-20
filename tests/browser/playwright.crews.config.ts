import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "crews.spec.ts",
  outputDir: "../../temp/test-results/crews",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1491",
    viewport: { width: 1100, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-crews.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1491/tests/browser/crews.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
