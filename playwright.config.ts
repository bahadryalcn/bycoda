import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./temp/test-results/browser",
  // The full Composer is tested with its bundled fixture config.
  testIgnore: [
    "git-checkouts.spec.ts",
    "composer-extras.spec.ts",
    "social.spec.ts",
    "project-workspace-navigation.spec.ts",
    "chat-artifacts.spec.ts",
    "transcript-rewind.spec.ts",
    "artifact-formats.spec.ts",
    "editor-navigation.spec.ts",
    // These fixtures need their dedicated servers and viewports.
    "merge-conflicts.spec.ts",
    "notes.spec.ts",
  ],
  globalSetup: "./tests/browser/warm-dev-server.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1435",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm exec vite --config tests/browser/vite.config.ts",
    url: "http://127.0.0.1:1435/tests/browser/transcript.html",
    reuseExistingServer: false,
  },
});
