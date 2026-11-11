import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "..",
  testMatch: "update-footer.spec.ts",
  outputDir: "../../../temp/verification/2026-10-27-update-footer/results",
  workers: 1,
  timeout: 45_000,
  use: {
    actionTimeout: 10_000,
    baseURL: "http://127.0.0.1:1487",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: process.env.UPDATE_FOOTER_PREBUILT
      ? "pnpm exec vite preview --config tests/browser/app-shell/update-footer.vite.config.ts"
      : "pnpm exec vite build --config tests/browser/app-shell/update-footer.vite.config.ts && pnpm exec vite preview --config tests/browser/app-shell/update-footer.vite.config.ts",
    url: "http://127.0.0.1:1487/tests/browser/app-shell/update-footer.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
