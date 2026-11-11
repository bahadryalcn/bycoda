import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-composer-compact",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/chat/composer-compact.html" },
  },
  preview: { host: "127.0.0.1", port: 51510, strictPort: true },
});
