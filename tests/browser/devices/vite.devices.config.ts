import { mergeConfig, defineConfig } from "vite";
import hostTools from "../host-tools/vite.host-tools.config.ts";

export default mergeConfig(
  hostTools,
  defineConfig({
    cacheDir: "temp/build/browser-devices-cache",
    build: {
      outDir: "temp/build/browser-devices",
      rolldownOptions: {
        input: [
          "tests/browser/host-tools/host-tools.html",
          "tests/browser/devices/device-stage.html",
        ],
      },
    },
    preview: { host: "127.0.0.1", port: 15741, strictPort: true },
  }),
);
