import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "git-checkouts.spec.ts",
  outputDir: "../../temp/test-results/git-checkouts",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1453", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.git-checkouts.config.ts && pnpm exec vite preview --config tests/browser/vite.git-checkouts.config.ts",
    url: "http://127.0.0.1:1453/tests/browser/git-workspace.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
