import { defineConfig } from "@playwright/test";
import composer from "./playwright.composer.config";
export default defineConfig({
  ...composer,
  testMatch: "composer-extras.spec.ts",
  outputDir: "../../temp/test-results/W6a-SESSIONS-composer",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
