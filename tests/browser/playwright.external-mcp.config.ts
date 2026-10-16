import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "external-mcp.spec.ts",
  workers: 1,
  timeout: 30_000,
  outputDir: "../../temp/test-results/external-mcp",
  use: { baseURL: "http://127.0.0.1:1479", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "node tests/browser/serve-external-mcp.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:1479/tests/browser/external-mcp.html",
    timeout: 120_000,
  },
});
