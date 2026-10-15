import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["host-tools.e2e.ts", "tools-workspace-resize.e2e.ts"],
  outputDir: "../../temp/test-results/host-tools",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:1438", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-host-tools.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1438/tests/browser/host-tools.html",
    reuseExistingServer: false,
  },
});
