import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "session-recovery.spec.ts",
  outputDir: "../../temp/test-results/session-recovery",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1447",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-session-recovery.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1447/tests/browser/session-recovery.html",
    reuseExistingServer: false,
  },
});
