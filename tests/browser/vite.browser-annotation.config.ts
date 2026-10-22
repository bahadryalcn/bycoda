import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /.*\/connections\/model\/hostFeatureClient$/,
        replacement: fileURLToPath(new URL("./browser-annotation-client.ts", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "temp/build/browser-annotation",
    emptyOutDir: false,
    rolldownOptions: {
      input: ["tests/browser/browser-annotation.html", "tests/browser/browser-element-target.html"],
    },
  },
  preview: { host: "127.0.0.1", port: 1444, strictPort: true },
});
