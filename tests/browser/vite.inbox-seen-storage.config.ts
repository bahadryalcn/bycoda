import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "temp/build/browser-inbox-seen-storage",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/inbox-seen-storage.html" },
  },
  preview: { host: "127.0.0.1", port: 17988, strictPort: true },
});
