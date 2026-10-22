import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: Object.fromEntries(
      [
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@codemirror/commands",
        "@lezer/common",
        "@lezer/highlight",
      ].map((name) => [
        name,
        fileURLToPath(new URL(`../../node_modules/${name}/dist/index.js`, import.meta.url)),
      ]),
    ),
  },
  build: {
    outDir: "temp/build/browser-notes",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/notes.html" },
  },
  preview: { host: "127.0.0.1", port: 1441, strictPort: true },
});
