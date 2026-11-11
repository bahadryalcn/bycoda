import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const port = Number(process.env.BYCODA_BROWSER_PORT ?? 15487);
const baseURL = `http://127.0.0.1:${port}`;

// Playwright owns only the isolated fixture process, never a native app or Host.
export default defineConfig({
  testDir: "..",
  testMatch: ["inline-visuals.spec.ts"],
  outputDir: "../../../temp/test-results/browser-inline-visuals",
  workers: 1,
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: `pnpm exec vite build --config tests/browser/chat/vite.inline-visuals.config.ts && pnpm exec vite preview --config tests/browser/chat/vite.inline-visuals.config.ts --port ${port}`,
    url: `${baseURL}/tests/browser/chat/inline-visuals.html`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
