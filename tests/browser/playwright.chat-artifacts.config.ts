import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: ["chat-artifacts.spec.ts", "artifact-formats.spec.ts"],
  outputDir: "../../temp/test-results/chat-artifacts",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:1449",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "node tests/browser/serve-chat-artifacts.mjs",
    url: "http://127.0.0.1:1449/tests/browser/transcript.html",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
