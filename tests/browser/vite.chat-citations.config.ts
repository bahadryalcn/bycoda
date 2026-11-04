import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "./fixtureSourceScan.ts";

export default defineConfig({
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  worker: { format: "es" },
  build: {
    minify: false,
    cssMinify: false,
    reportCompressedSize: false,
    outDir: "temp/build/browser-chat-citations",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/chat-citations.html"] },
  },
  preview: { host: "127.0.0.1", port: 15479, strictPort: true },
});
