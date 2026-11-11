import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "..",
  testMatch: "generated-file-links.spec.ts",
  outputDir: "../../../temp/test-results/generated-file-links",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:14783", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/chat/generated-file-links.vite.config.ts && pnpm exec vite preview --config tests/browser/chat/generated-file-links.vite.config.ts",
    url: "http://127.0.0.1:14783/tests/browser/chat/generated-file-links.html",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
