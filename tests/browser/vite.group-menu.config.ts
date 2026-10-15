import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/group-menu.html"] },
  build: {
    outDir: "temp/build/browser-group-menu",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/group-menu.html" },
  },
  preview: { host: "127.0.0.1", port: 1443, strictPort: true },
});
