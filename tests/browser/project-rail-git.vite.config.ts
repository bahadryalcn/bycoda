import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Browser-local fixture server. Pass PROJECT_RAIL_GIT_PORT to pick the port (default 1473).
const port = Number(process.env.PROJECT_RAIL_GIT_PORT ?? 1473);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port, strictPort: true },
  build: {
    outDir: "temp/build/browser-project-rail-git",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/project-rail-git.html" },
  },
  preview: { host: "127.0.0.1", port, strictPort: true },
});
