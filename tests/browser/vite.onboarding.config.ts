import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-onboarding",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/onboarding.html" },
  },
  preview: { host: "127.0.0.1", port: 1456, strictPort: true },
});
