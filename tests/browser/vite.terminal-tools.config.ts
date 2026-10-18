import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "terminal-fixture-pty",
      enforce: "pre",
      resolveId(id) {
        if (id.endsWith("/platform/tauri/pty"))
          return resolve("tests/browser/terminal-tools-pty.ts");
      },
    },
  ],
  build: {
    outDir: "temp/build/browser-terminal-tools",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/terminal-tools.html" },
  },
  preview: { host: "127.0.0.1", port: 1457, strictPort: true },
});
