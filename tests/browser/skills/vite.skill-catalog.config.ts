import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";
export default defineConfig({
  cacheDir: "temp/build/skill-catalog-cache",
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/skills/skill-catalog.html"] },
  build: {
    outDir: "temp/build/skill-catalog",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/skills/skill-catalog.html"] },
  },
  preview: { host: "127.0.0.1", port: 1517, strictPort: true },
});
