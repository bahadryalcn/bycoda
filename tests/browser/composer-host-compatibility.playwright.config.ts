import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "composer-host-compatibility.spec.ts",
  outputDir: "../../temp/test-results/c1-composer-host-compatibility",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:1447", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "node tests/browser/serve-composer-host-compatibility.mjs",
    url: "http://127.0.0.1:1447/tests/browser/composer-host-compatibility.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
