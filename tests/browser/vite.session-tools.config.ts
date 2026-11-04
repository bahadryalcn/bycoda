import { fixtureSourceScan } from "./fixtureSourceScan.ts";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(new URL("./session-tools-mocks.ts", import.meta.url));
const host = fileURLToPath(new URL("./session-tools-host-mocks.ts", import.meta.url));
export default defineConfig({
  cacheDir: "temp/build/browser-session-tools-cache",
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /.*\/connections\/model\/hostFeatureClient$/, replacement: host },
      { find: /.*\/toolsHubTransport$/, replacement: fixture },
      { find: /.*\/hostToolsWindowGeometry$/, replacement: fixture },
      { find: "@tauri-apps/api/webviewWindow", replacement: fixture },
      { find: /.*\/app\/model\/windowNavigation$/, replacement: fixture },
    ],
  },
  build: {
    outDir: "temp/build/browser-session-tools",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/session-tools.html" },
  },
  preview: { host: "127.0.0.1", port: 1483, strictPort: true },
});
