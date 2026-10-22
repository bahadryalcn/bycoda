import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The real rail has many imports; bundle it for deterministic browser startup.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-workspace-navigation",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/project-workspace-navigation.html" },
  },
  preview: { host: "127.0.0.1", port: 1449, strictPort: true },
});
