import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "./fixtureSourceScan.ts";
export default defineConfig({
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/usage-budgets.html"] },
  server: { watch: null },
  build: {
    outDir: "temp/build/browser-usage-budgets",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/usage-budgets.html" },
  },
  preview: { host: "127.0.0.1", port: 1468, strictPort: true },
});
