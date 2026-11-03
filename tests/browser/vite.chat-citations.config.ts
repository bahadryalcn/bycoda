import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
