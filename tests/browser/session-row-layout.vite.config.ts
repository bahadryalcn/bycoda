import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/tests/browser/",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["session-row-layout.html"] },
  server: {
    host: "127.0.0.1",
    port: 15519,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  build: {
    outDir: fileURLToPath(new URL("../../temp/build/session-row-layout", import.meta.url)),
    emptyOutDir: false,
    rolldownOptions: {
      input: fileURLToPath(new URL("./session-row-layout.html", import.meta.url)),
    },
  },
  preview: { host: "127.0.0.1", port: 15520, strictPort: true },
});
