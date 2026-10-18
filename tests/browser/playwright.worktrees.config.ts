import { defineConfig } from "@playwright/test";
import settings from "./playwright.settings.config";

export default defineConfig({
  ...settings,
  testMatch: ["worktrees.e2e.ts"],
  outputDir: "../../temp/test-results/worktrees",
  use: { ...settings.use, baseURL: "http://127.0.0.1:1497" },
  webServer: {
    command:
      "pnpm exec vite build --config tests/browser/vite.worktrees.config.ts && pnpm exec vite preview --config tests/browser/vite.worktrees.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:1497/tests/browser/worktrees.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
