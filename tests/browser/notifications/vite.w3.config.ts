import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-w3",
    emptyOutDir: true,
    rolldownOptions: { input: "tests/browser/notifications/w3-feedback.html" },
  },
  preview: { host: "127.0.0.1", port: 1499, strictPort: true },
});
