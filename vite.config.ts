import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readBuildIdentity } from "./scripts/build/build-info.mjs";
import { reactCompiler } from "./scripts/build/react-compiler";
import { workerRuntimePlugins } from "./scripts/build/worker-runtime.mjs";
import { fmt, lint } from "./scripts/checks/lint-config.mjs";

const host = process.env.TAURI_DEV_HOST;
const devPort = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid ${name}`);
  }
  return port;
};

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";
  const buildIdentity = await readBuildIdentity(
    process.env.BYCODA_BUILD_MANIFEST || resolve("build/build-info.json"),
  );
  if (process.env.BYCODA_BUILD_MANIFEST && !buildIdentity)
    throw new Error("Frozen build manifest is invalid or missing");

  return {
    plugins: [
      react(),
      reactCompiler(),
      tailwindcss(),
      {
        name: "bycoda-build-identity",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify(buildIdentity),
          });
        },
      },
    ],
    define: { __BYCODA_BUILD_IDENTITY__: JSON.stringify(buildIdentity) },
    worker: { plugins: workerRuntimePlugins },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    clearScreen: false,
    // Rules: docs/reference/rules.md. `vp lint`, `vp fmt` and the check scripts read these.
    lint,
    fmt,
    // These are only reached through lazily loaded modules, so the startup scan
    // misses them; finding them later reloads the page mid-IPC on first run.
    optimizeDeps: {
      include: [
        "@tauri-apps/api/webviewWindow",
        "@tauri-apps/plugin-process",
        "@tauri-apps/plugin-updater",
        "zustand/vanilla",
      ],
    },
    build: {
      // Preserve the browser targets used before the Vite 8 upgrade.
      // Opt-in diagnostic builds keep component names in React errors.
      ...(process.env.BYCODA_NO_MINIFY === "1" ? { minify: false as const } : {}),
      target: ["chrome107", "edge107", "firefox104", "safari16"],
      rolldownOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
          voiceOverlay: "voice-overlay.html",
          desktopControl: "desktop-control.html",
        },
      },
    },
    server: {
      port: devPort("BYCODA_VITE_PORT", 1420),
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host || process.env.BYCODA_HMR_PORT
          ? {
              protocol: "ws",
              host: host || "127.0.0.1",
              port: devPort("BYCODA_HMR_PORT", 1421),
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**", "**/temp/**"],
      },
    },
  };
});
