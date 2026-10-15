import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@lezer/common",
      "@lezer/highlight",
    ],
  },
  build: {
    outDir: "temp/build/browser-editor-navigation",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/editor-navigation.html" },
  },
  preview: { host: "127.0.0.1", port: 1453, strictPort: true },
});
