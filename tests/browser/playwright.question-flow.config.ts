import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "question-flow.spec.ts",
  outputDir: "../../temp/test-results/browser-question-flow",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1446", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-question-flow.mjs",
    url: "http://127.0.0.1:1446/tests/browser/question-flow.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
