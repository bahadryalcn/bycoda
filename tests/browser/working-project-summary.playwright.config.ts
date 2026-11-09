import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "working-project-summary.spec.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../../temp/verification/2026-11-04-working-project-summary/test-results",
  use: {
    baseURL: "http://127.0.0.1:15530",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
