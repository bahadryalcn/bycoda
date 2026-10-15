import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "project-workspace-navigation.spec.ts",
  outputDir: "../../temp/test-results/workspace-navigation",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1449",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.workspace-navigation.config.ts && pnpm exec vite preview --config tests/browser/vite.workspace-navigation.config.ts",
    url: "http://127.0.0.1:1449/tests/browser/project-workspace-navigation.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
