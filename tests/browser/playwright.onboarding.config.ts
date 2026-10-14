import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["onboarding.spec.ts", "usage-guide.spec.ts"],
  outputDir: "../../temp/test-results/onboarding",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1456",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-onboarding.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1456/tests/browser/onboarding.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
