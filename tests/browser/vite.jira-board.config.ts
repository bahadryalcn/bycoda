import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    outDir: "temp/build/browser-jira-board",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/jira-board.html" },
  },
  preview: { host: "127.0.0.1", port: 1443, strictPort: true },
  optimizeDeps: { entries: ["tests/browser/jira-board.html"] },
  server: {
    host: "127.0.0.1",
    port: 1443,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/temp/**"] },
  },
});
