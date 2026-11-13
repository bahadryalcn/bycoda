import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/privacy-permissions-06",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/settings/privacy-permissions-06.html" },
  },
  preview: { host: "127.0.0.1", port: 1476, strictPort: true },
});
