import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 15529, strictPort: true },
  build: {
    outDir: "temp/build/working-project-summary",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/working-project-summary.html" },
  },
  preview: { host: "127.0.0.1", port: 15530, strictPort: true },
});
