import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";
const mock = fileURLToPath(new URL("./host-tools-mocks.ts", import.meta.url));
export default defineConfig({
  cacheDir: "temp/build/browser-host-tools-cache",
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  resolve: {
    alias: [{ find: /.*\/connections\/model\/hostFeatureClient$/, replacement: mock }],
  },
  build: {
    outDir: "temp/build/browser-host-tools",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/host-tools/host-tools.html" },
  },
  preview: { host: "127.0.0.1", port: 1438, strictPort: true },
});
