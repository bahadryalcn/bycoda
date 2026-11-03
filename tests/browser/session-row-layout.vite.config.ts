import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 15519, strictPort: true },
  build: {
    outDir: "temp/build/session-row-layout",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/session-row-layout.html" },
  },
  preview: { host: "127.0.0.1", port: 15520, strictPort: true },
});
