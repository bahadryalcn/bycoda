import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";

export default defineConfig({
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-git-checkouts",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/source-control/git-workspace.html" },
  },
  preview: { host: "127.0.0.1", port: 1453, strictPort: true },
});
