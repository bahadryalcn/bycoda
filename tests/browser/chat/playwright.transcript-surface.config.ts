import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: "..",
  testMatch: "transcript-surface.spec.ts",
  outputDir: "../../../temp/test-results/transcript-surface",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:15710",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/chat/vite.transcript-scenario.config.ts && pnpm exec vite preview --config tests/browser/chat/vite.transcript-scenario.config.ts",
    url: "http://127.0.0.1:15710/tests/browser/chat/transcript-scenario.html",
    reuseExistingServer: false,
    timeout: 300000,
  },
});
