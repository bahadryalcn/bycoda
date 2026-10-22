import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-settings",
    emptyOutDir: false,
    rolldownOptions: {
      input: ["tests/browser/settings.html", "tests/browser/live-backgrounds.html"],
    },
  },
  preview: { host: "127.0.0.1", port: 1468, strictPort: true },
});
