import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  build: {
    outDir: "temp/build/browser-canvas-paired",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/crews/canvas-paired.html" },
  },
  preview: {
    host: "127.0.0.1",
    port: 1453,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
