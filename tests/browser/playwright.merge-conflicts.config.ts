import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: ["merge-conflicts.spec.ts", "git-workspace.spec.ts"],
  grep: /merge editor|conflict sonucu/,
  outputDir: "../../temp/test-results/merge-conflicts",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1457", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "pnpm exec vite build --config tests/browser/vite.merge-conflicts.config.ts && pnpm exec vite preview --config tests/browser/vite.merge-conflicts.config.ts",
    url: "http://127.0.0.1:1457/tests/browser/merge-conflicts.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
