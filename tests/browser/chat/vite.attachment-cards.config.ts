import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    outDir: "temp/build/attachment-cards",
    emptyOutDir: false,
    minify: false,
    cssMinify: false,
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        attachments: fileURLToPath(new URL("./attachment-cards.html", import.meta.url)),
        composer: fileURLToPath(new URL("./composer-extras.html", import.meta.url)),
      },
    },
  },
  optimizeDeps: {
    entries: [
      "tests/browser/chat/attachment-cards.html",
      "tests/browser/chat/composer-extras.html",
    ],
    noDiscovery: true,
    // Discovery is off, so CommonJS dependencies reached by the real Composer
    // graph (streamdown pulls style-to-js through the activity dock) must be
    // pre-bundled here or the browser cannot import their default export.
    include: ["react", "react-dom/client", "@tanstack/react-query", "streamdown"],
  },
  server: {
    host: "127.0.0.1",
    port: 15529,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/temp/**", "**/test-results/**"] },
  },
});
