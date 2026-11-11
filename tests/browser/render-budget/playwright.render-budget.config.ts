import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// The full run takes about 4 minutes: module graph warm-up, 60 s idle, 35 s tasks board and the
// short scenarios. Playwright owns only the isolated fixture dev server, never a native app or Host.
export default defineConfig({
  testDir: "..",
  testMatch: ["render-budget.spec.ts"],
  outputDir: "../../../temp/test-results/browser-render-budget",
  workers: 1,
  timeout: 240_000,
  use: { baseURL: "http://127.0.0.1:15531", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: "node scripts/checks/browser-fixture-server.mjs --suite render-budget",
    env: { BYCODA_BROWSER_PORT: "15531" },
    url: "http://127.0.0.1:15531/tests/browser/render-budget/shell.html",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
