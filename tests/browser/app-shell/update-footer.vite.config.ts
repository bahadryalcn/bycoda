import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";

export default defineConfig({
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1487, strictPort: true },
  build: {
    outDir: "temp/build/browser-update-footer",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/app-shell/update-footer.html" },
  },
  preview: { host: "127.0.0.1", port: 1487, strictPort: true },
});
