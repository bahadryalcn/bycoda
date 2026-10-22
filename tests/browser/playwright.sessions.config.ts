import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "transcript-scroll.spec.ts",
    "transcript-long-text.spec.ts",
    "transcript-rewind.spec.ts",
    "sessions-streaming.spec.ts",
  ],
  outputDir: "../../temp/test-results/W6a-SESSIONS",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:1464",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/serve-sessions.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1464/tests/browser/transcript.html",
    timeout: 180000,
    reuseExistingServer: false,
  },
});
