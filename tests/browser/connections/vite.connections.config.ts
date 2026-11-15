import { defineConfig } from "vite";
import settings from "../settings/vite.settings.config";

export default defineConfig({
  ...settings,
  define: {
    ...settings.define,
    __BYCODA_BUILD_IDENTITY__: JSON.stringify({
      buildId: "0.7.9",
      branch: "fixture",
      head: "00000000",
    }),
  },
  build: { ...settings.build, outDir: "temp/build/browser-connections" },
  preview: { host: "127.0.0.1", port: 18438, strictPort: true },
});
