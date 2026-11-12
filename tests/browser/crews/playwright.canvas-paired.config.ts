import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "..",
  testMatch: ["canvas-paired.spec.ts", "canvas-dot-paired.spec.ts"],
  outputDir: "../../../temp/test-results/canvas-paired",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:1453", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium", deviceScaleFactor: 2 } }],
});
