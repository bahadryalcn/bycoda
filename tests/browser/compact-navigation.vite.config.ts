import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1472, strictPort: true },
  build: {
    outDir: "temp/build/browser-compact-navigation",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/compact-navigation.html" },
  },
  preview: { host: "127.0.0.1", port: 1472, strictPort: true },
});
