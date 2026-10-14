import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "editor-selection.spec.ts",
  outputDir: "../../temp/test-results/editor-selection",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1451",
    viewport: { width: 1000, height: 700 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.editor-selection.config.ts && pnpm exec vite preview --config tests/browser/vite.editor-selection.config.ts",
    url: "http://127.0.0.1:1451/tests/browser/editor-selection.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
