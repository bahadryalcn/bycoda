import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "inbox-seen-storage.spec.ts",
  outputDir: "../../temp/test-results/inbox-seen-storage",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:17988", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-inbox-seen-storage.mjs",
    url: "http://127.0.0.1:17988/tests/browser/inbox-seen-storage.html",
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
