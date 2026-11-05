import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "tests/browser",
  plugins: [
    {
      name: "title-settings-bounded-theme-scan",
      enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/src/styles/index.css")) return;
        return source.replace(
          '@import "tailwindcss";',
          '@import "tailwindcss" source(none);\n@source "../";',
        );
      },
    },
    react(),
    tailwindcss(),
  ],
  cacheDir: resolve("temp/local/title-settings/vite-cache-narrow"),
  optimizeDeps: {
    noDiscovery: true,
    entries: ["title-settings.html"],
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@tanstack/react-query",
    ],
  },
  build: {
    outDir: resolve("temp/build/browser-title-settings"),
    emptyOutDir: false,
    rolldownOptions: { input: resolve("tests/browser/title-settings.html") },
  },
  server: {
    host: "127.0.0.1",
    port: 1479,
    strictPort: true,
    preTransformRequests: false,
    fs: { allow: [resolve(".")] },
    watch: { ignored: ["**/temp/**", "**/mobile/**", "**/host/**", "**/src-tauri/**"] },
  },
});
