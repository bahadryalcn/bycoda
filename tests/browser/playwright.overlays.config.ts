import { defineConfig } from "@playwright/test";
import { overlayFixture } from "./overlay-fixtures";

const fixture = overlayFixture();

export default defineConfig({
  testDir: ".",
  testMatch: fixture.names.map((name) => `overlay-${name}.spec.ts`),
  outputDir: `../../temp/test-results/overlays-${fixture.id}`,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: `http://127.0.0.1:${fixture.port}`,
    viewport: { width: 1280, height: 800 },
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-overlays.mjs",
    cwd: "../..",
    url: `http://127.0.0.1:${fixture.port}/tests/browser/overlay-${fixture.names[0]}.html`,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
