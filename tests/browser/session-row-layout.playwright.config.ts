import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "session-row-layout.spec.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../../temp/verification/2026-11-04-last-sessions-workspace/test-results",
  use: {
    baseURL: "http://127.0.0.1:15520",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/session-row-layout.vite.config.ts --logLevel error && pnpm exec vite preview --config tests/browser/session-row-layout.vite.config.ts",
    url: "http://127.0.0.1:15520/tests/browser/session-row-layout.html",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
