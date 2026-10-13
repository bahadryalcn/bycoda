import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-social",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/social.html" },
  },
  preview: { host: "127.0.0.1", port: 1437, strictPort: true },
});
