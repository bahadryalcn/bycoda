import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "composer-compact.spec.ts",
  outputDir: "../../temp/test-results/composer-compact",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:51510",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.composer-compact.config.ts && pnpm exec vite preview --config tests/browser/vite.composer-compact.config.ts",
    url: "http://127.0.0.1:51510/tests/browser/composer-compact.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
