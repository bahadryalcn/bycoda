import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  cacheDir: "temp/build/browser-annotation-cache",
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /.*\/connections\/model\/hostFeatureClient$/,
        replacement: fileURLToPath(new URL("./browser-annotation-client.ts", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "temp/build/browser-annotation",
    emptyOutDir: false,
    rolldownOptions: {
      input: [
        "tests/browser/host-tools/browser-annotation.html",
        "tests/browser/host-tools/browser-element-target.html",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 1444, strictPort: true },
});
