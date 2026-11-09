import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: ["s31-outbox-storage.spec.ts", "s31-session-bindings.spec.ts"],
  outputDir: "../../temp/test-results/s31-outbox-storage",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:17997", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-s31-outbox-storage.mjs",
    url: "http://127.0.0.1:17997/tests/browser/s31-outbox-storage.html",
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
