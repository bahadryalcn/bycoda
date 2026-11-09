import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The transcript suite visits ten fixture pages. A dev server optimizes dependencies per visited
 * page (a cold scan outlasts the 300 s warm-up), so the suite builds them once and serves the result.
 */
const pages = [
  "chat-chrome",
  "crew-scene",
  "editor-selection",
  "git-workspace",
  "localization",
  "quick-composer",
  "shared-controls",
  "transcript",
  "upstream-011",
  "workspace-layout",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-transcript",
    emptyOutDir: false,
    rolldownOptions: {
      input: Object.fromEntries(pages.map((page) => [page, `tests/browser/${page}.html`])),
    },
  },
  preview: { host: "127.0.0.1", port: 1435, strictPort: true },
});
