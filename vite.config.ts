import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    clearScreen: false,
    // These are only reached through lazily loaded modules, so the startup scan
    // misses them; finding them later reloads the page mid-IPC on first run.
    optimizeDeps: {
      include: ["@tauri-apps/api/webviewWindow", "zustand/vanilla"],
    },
    build: {
      // Preserve the browser targets used before the Vite 8 upgrade.
      target: ["chrome107", "edge107", "firefox104", "safari16"],
      rolldownOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**", "**/temp/**"],
      },
    },
  };
});
