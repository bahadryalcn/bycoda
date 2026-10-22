import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "session-usability.spec.ts",
  outputDir: "../../temp/test-results/session-usability",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1488",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.session-usability.config.ts && pnpm exec vite preview --config tests/browser/vite.session-usability.config.ts",
    url: "http://127.0.0.1:1488/tests/browser/session-usability.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
