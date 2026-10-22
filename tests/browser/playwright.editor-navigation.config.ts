import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "editor-navigation.spec.ts",
  outputDir: "../../temp/verification/2026-10-13-editor-navigation/browser",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1453", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: "../..",
    command: "node tests/browser/serve-editor-navigation.mjs",
    url: "http://127.0.0.1:1453/tests/browser/editor-navigation.html",
    reuseExistingServer: false,
  },
});
