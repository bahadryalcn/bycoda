import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "tasks.spec.ts",
  outputDir: "../../temp/test-results/browser-tasks",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1438", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-tasks.mjs",
    url: "http://127.0.0.1:1438/tests/browser/tasks.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
