import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "servers.spec.ts",
    "ssh-key-binding.spec.ts",
    "servers-workspace.spec.ts",
    "server-recovery.spec.ts",
  ],
  workers: 1,
  timeout: 30000,
  outputDir: "../../temp/test-results/servers",
  use: { baseURL: "http://127.0.0.1:18518", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "node tests/browser/serve-settings.mjs tests/browser/vite.servers.config.ts",
    cwd: "../..",
    url: "http://127.0.0.1:18518/tests/browser/servers.html",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
