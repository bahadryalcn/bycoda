import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "notifications.e2e.ts",
  outputDir: "../../temp/test-results/notifications",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1498", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command:
      "pnpm exec vite build --config tests/browser/vite.notifications.config.ts && pnpm exec vite preview --config tests/browser/vite.notifications.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:1498/tests/browser/notifications.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
