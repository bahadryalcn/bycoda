import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "..",
  testMatch: ["chat-citations.spec.ts"],
  outputDir: "../../../temp/test-results/browser-chat-citations",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:15479", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: "node tests/browser/chat/serve-chat-citations.mjs",
    url: "http://127.0.0.1:15479/tests/browser/chat/chat-citations.html",
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
