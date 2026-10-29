import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: Object.fromEntries(
      [
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@codemirror/commands",
        "@lezer/common",
        "@lezer/highlight",
      ].map((name) => [
        name,
        fileURLToPath(new URL(`../../node_modules/${name}/dist/index.js`, import.meta.url)),
      ]),
    ),
  },
  cacheDir: "temp/local/2026-10-29-session-references/vite-cache",
  optimizeDeps: {
    entries: ["tests/browser/session-references.html"],
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "streamdown",
      "rehype-harden",
      "zustand/traditional",
    ],
    holdUntilCrawlEnd: false,
  },
  server: {
    host: "127.0.0.1",
    port: 14679,
    strictPort: true,
    hmr: false,
    // Acceptance runs exercise one immutable source snapshot. Avoid watching the
    // shared checkout's large, actively written Native/temp trees during checks.
    watch: null,
  },
});
