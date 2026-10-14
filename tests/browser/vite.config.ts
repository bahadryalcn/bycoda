import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Prepare only the browser fixtures; normal desktop entry points stay unchanged. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  optimizeDeps: { entries: ["tests/browser/transcript.html"] },
  server: {
    host: "127.0.0.1",
    port: 1435,
    strictPort: true,
    warmup: { clientFiles: ["tests/browser/transcript.tsx"] },
    watch: { ignored: ["**/src-tauri/**", "**/temp/**", "**/test-results/**"] },
  },
});
