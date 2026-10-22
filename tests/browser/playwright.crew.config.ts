import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "star-wars-crew.spec.ts",
  outputDir: "../../temp/test-results/crew",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1453",
    viewport: { width: 1200, height: 950 },
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node tests/browser/serve-crew.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1453/tests/browser/crew-scene.html",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
