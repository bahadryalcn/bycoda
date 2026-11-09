import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/text-actions.html"] },
  server: {
    host: "127.0.0.1",
    port: 15439,
    strictPort: true,
    watch: { ignored: ["**/temp/**", "**/src-tauri/**"] },
  },
  build: {
    outDir: "temp/build/browser-text-actions",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/text-actions.html"] },
  },
  preview: { host: "127.0.0.1", port: 15439, strictPort: true },
});
