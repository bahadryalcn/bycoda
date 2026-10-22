import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "group-menu.spec.ts",
  outputDir: "../../temp/test-results/group-menu",
  use: { baseURL: "http://127.0.0.1:1443", browserName: "chromium", headless: true },
  webServer: {
    command: "node tests/browser/serve-group-menu.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1443/tests/browser/group-menu.html",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
