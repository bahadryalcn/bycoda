import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "../model/useFeatureHighlights",
        replacement: fileURLToPath(new URL("./useFeatureHighlights.fixture.ts", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "temp/build/browser-onboarding",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/onboarding/onboarding.html" },
  },
  preview: { host: "127.0.0.1", port: 1456, strictPort: true },
});
