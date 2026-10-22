import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  outputDir: "../../temp/test-results/browser-composer",
  testMatch: ["composer-extras.spec.ts", "git-generation.spec.ts", "workspace-layout.spec.ts"],
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:1436", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-composer.mjs",
    url: "http://127.0.0.1:1436/tests/browser/composer-extras.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
