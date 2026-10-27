import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-edit-from-here",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/edit-from-here.html" },
  },
  preview: { host: "127.0.0.1", port: 1549, strictPort: true },
});
