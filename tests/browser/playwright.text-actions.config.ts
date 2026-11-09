import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  outputDir: "../../temp/test-results/browser-text-actions",
  testMatch: ["text-actions.spec.ts"],
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:15439", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-text-actions.mjs",
    url: "http://127.0.0.1:15439/tests/browser/text-actions.html",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
