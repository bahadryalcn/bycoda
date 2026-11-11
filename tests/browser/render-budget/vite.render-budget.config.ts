import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { reactCompiler } from "../../../scripts/build/react-compiler";

// Same transform pipeline as the app's vite.config.ts (React + React Compiler), so the counted
// renders are those of compiled components. Dev server only; no HMR or file watching during a run.
export default defineConfig({
  plugins: [react(), reactCompiler(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  clearScreen: false,
  optimizeDeps: {
    // Scan only the fixture pages, not every html file in the checkout (temp/ holds thousands).
    entries: ["tests/browser/render-budget/shell.html", "tests/browser/render-budget/tasks.html"],
    include: [
      "@tauri-apps/api/webviewWindow",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-updater",
      "zustand/vanilla",
    ],
  },
  server: { host: "127.0.0.1", hmr: false, watch: null },
});
