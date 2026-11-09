import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "session-references.spec.ts",
  outputDir: "../../temp/test-results/session-references",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:14679",
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-proxy-server", "--disable-features=LocalNetworkAccessChecks"] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
