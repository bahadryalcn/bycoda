import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-servers",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/servers.html" },
  },
  preview: { host: "127.0.0.1", port: 18518, strictPort: true },
});
