import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "temp/build/browser-s31-outbox",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/sessions/s31-outbox-storage.html" },
  },
  preview: { host: "127.0.0.1", port: 17997, strictPort: true },
});
