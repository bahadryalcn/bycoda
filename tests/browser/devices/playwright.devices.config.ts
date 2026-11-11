import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "..",
  testMatch: "devices.e2e.ts",
  outputDir: "../../../temp/test-results/devices-upgrade",
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          "../../../temp/verification/2026-11-04-devices-upgrade/fixture/test-results.json",
      },
    ],
  ],
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:15741", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/devices/serve-devices.mjs",
    cwd: "../../..",
    url: "http://127.0.0.1:15741/tests/browser/host-tools/host-tools.html",
    reuseExistingServer: process.env.BYCODA_DEVICES_FIXTURE_RUNNING === "1",
    timeout: 180000,
  },
});
