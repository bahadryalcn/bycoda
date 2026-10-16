import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-external-mcp",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/external-mcp.html" },
  },
  preview: { host: "127.0.0.1", port: 1479, strictPort: true },
});
