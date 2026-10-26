import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "compact-navigation.spec.ts",
  outputDir: "../../temp/verification/2026-10-26-navigation-v2",
  workers: 1,
  timeout: 120_000,
  use: {
    actionTimeout: 10_000,
    baseURL: "http://127.0.0.1:1472",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: process.env.COMPACT_NAVIGATION_PREBUILT
      ? "pnpm exec vite preview --config tests/browser/compact-navigation.vite.config.ts"
      : "pnpm exec vite build --config tests/browser/compact-navigation.vite.config.ts && pnpm exec vite preview --config tests/browser/compact-navigation.vite.config.ts",
    url: "http://127.0.0.1:1472/tests/browser/compact-navigation.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
