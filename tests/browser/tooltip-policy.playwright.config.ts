import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "tooltip-policy.spec.ts",
  workers: 1,
  timeout: 90000,
  outputDir: "../../temp/verification/2026-11-11-tooltip-fix/browser-results",
  use: { baseURL: "http://127.0.0.1:1459", headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/tooltip-policy.serve.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1459/tests/browser/tooltip-policy.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
