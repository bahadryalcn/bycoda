import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/arc-controls.html"] },
  build: {
    outDir: "temp/build/browser-arc-controls",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/arc-controls.html" },
  },
  preview: { host: "127.0.0.1", port: 1442, strictPort: true },
});
