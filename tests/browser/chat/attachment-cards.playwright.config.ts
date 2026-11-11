import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "..",
  testMatch: ["attachment-cards.spec.ts"],
  outputDir: "../../../temp/test-results/browser-attachment-cards",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:15529", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: "pnpm exec vite --config tests/browser/chat/vite.attachment-cards.config.ts",
    url: "http://127.0.0.1:15529/tests/browser/chat/attachment-cards.html",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
