import { defineConfig } from "vite";
import settings from "./vite.settings.config";

export default defineConfig({
  ...settings,
  build: { ...settings.build, outDir: "temp/build/browser-connections" },
  preview: { host: "127.0.0.1", port: 18438, strictPort: true },
});
