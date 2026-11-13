import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /.*\/platform\/tauri\/fs$/,
        replacement: fileURLToPath(new URL("./folder-picker-fs.ts", import.meta.url)),
      },
    ],
  },
  optimizeDeps: { entries: ["tests/browser/projects/folder-picker.html"] },
  server: { host: "127.0.0.1", port: 15631, strictPort: true },
  build: {
    outDir: "temp/build/folder-picker-layout",
    emptyOutDir: true,
    rolldownOptions: { input: "tests/browser/projects/folder-picker.html" },
  },
  preview: { host: "127.0.0.1", port: 15631, strictPort: true },
});
