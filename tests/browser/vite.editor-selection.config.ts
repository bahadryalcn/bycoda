import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-editor-selection",
    emptyOutDir: false,
    rolldownOptions: {
      input: ["tests/browser/editor-selection.html", "tests/browser/file-save.html"],
    },
  },
  preview: { host: "127.0.0.1", port: 1451, strictPort: true },
});
