import { defineConfig, mergeConfig } from "vite";
import base from "./vite.settings.config";
export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: "temp/build/settings-collection-visual" },
    preview: { port: 1477 },
  }),
);
