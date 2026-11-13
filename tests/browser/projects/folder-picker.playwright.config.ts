import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "folder-picker.spec.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../../../temp/verification/folder-picker-layout/test-results",
  use: { baseURL: "http://127.0.0.1:15631", headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command:
      "node node_modules/vite-plus/bin/vp build --config tests/browser/projects/folder-picker.vite.config.ts && node node_modules/vite-plus/bin/vp preview --config tests/browser/projects/folder-picker.vite.config.ts",
    url: "http://127.0.0.1:15631/tests/browser/projects/folder-picker.html",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
