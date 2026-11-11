import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/app-shell/remote-connection-feedback.html"] },
  server: { host: "127.0.0.1", port: 15483, strictPort: true },
  preview: { host: "127.0.0.1", port: 15483, strictPort: true },
  build: {
    outDir: "temp/build/browser-remote-connection-feedback",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/app-shell/remote-connection-feedback.html"] },
  },
});
