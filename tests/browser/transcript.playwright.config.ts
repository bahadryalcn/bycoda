import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../../temp/test-results/browser",
  // The full Composer is tested with its bundled fixture config.
  testIgnore: [
    "subagent-relay.spec.ts",
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
  globalSetup: "./warm-dev-server.ts",
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
    command:
      "pnpm exec vite build --config tests/browser/vite.transcript.config.ts && pnpm exec vite preview --config tests/browser/vite.transcript.config.ts",
    url: "http://127.0.0.1:1435/tests/browser/transcript.html",
    reuseExistingServer: false,
    // The fixture pages are built before they are served; a cold build outlasts the 60 s default.
    timeout: 300_000,
  },
});
