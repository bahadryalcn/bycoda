import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-transcript-scenario",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/chat/transcript-scenario.html" },
  },
  preview: { host: "127.0.0.1", port: 15710, strictPort: true },
});
