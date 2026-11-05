import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    {
      name: "session-reference-worker-transport",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          /(?:^|\/)useReadOnlyHostSession(?:\.ts)?$/.test(source) &&
          /\/AgentTabView\.tsx(?:\?|$)/.test(importer?.replaceAll("\\", "/") ?? "")
        )
          return fileURLToPath(new URL("./session-references-host-reader.ts", import.meta.url));
      },
    },
    {
      name: "session-reference-fixture-styles",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/styles/index.css")) return;
        return code.replace(
          '@import "tailwindcss";',
          '@import "tailwindcss" source(none);\n@source "../../src";\n@source "../../tests/browser/session-references.tsx";',
        );
      },
    },
    tailwindcss(),
  ],
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
  cacheDir: "temp/local/2026-10-30-session-references/vite-cache",
  optimizeDeps: {
    entries: ["tests/browser/session-references.html"],
    // Keep this fixture's dependency set stable while the large shared checkout
    // changes. Repeated discovery can otherwise invalidate in-flight module URLs.
    noDiscovery: true,
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "streamdown",
      "rehype-harden",
      "zustand/traditional",
      "zustand/vanilla",
      "@tanstack/react-query",
      "@tanstack/react-virtual",
      "lucide-react",
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
      "@radix-ui/react-select",
      "@radix-ui/react-switch",
      "react-material-icon-theme",
      "dompurify",
      "qrcode.react",
      "motion/react",
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
