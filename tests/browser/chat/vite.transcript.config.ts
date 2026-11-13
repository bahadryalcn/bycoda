import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The transcript suite visits ten fixture pages. A dev server optimizes dependencies per visited
 * page (a cold scan outlasts the 300 s warm-up), so the suite builds them once and serves the result.
 */
const pages = [
  "chat/chat-chrome",
  "crews/crew-scene",
  "files/editor-selection",
  "source-control/git-workspace",
  "settings/localization",
  "quick-composer/quick-composer",
  "shared-ui/shared-controls",
  "chat/transcript",
  "chat/upstream-011",
  "workspace/workspace-layout",
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
