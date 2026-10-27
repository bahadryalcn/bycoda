import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "edit-from-here.spec.ts",
  outputDir: "../../temp/test-results/edit-from-here",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1549",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/edit-from-here.vite.config.ts && pnpm exec vite preview --config tests/browser/edit-from-here.vite.config.ts",
    url: "http://127.0.0.1:1549/tests/browser/edit-from-here.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
