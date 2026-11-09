import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-messaging-integrations",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/messaging-integrations.html" },
  },
  preview: { host: "127.0.0.1", port: 15761, strictPort: true },
});
