import { defineConfig, mergeConfig } from "vite";
import room from "./vite.assistant-room.config.ts";

export default mergeConfig(
  room,
  defineConfig({
    build: { outDir: "temp/build/assistant-settings" },
    server: { host: "127.0.0.1", port: 15645, strictPort: true },
    preview: { host: "127.0.0.1", port: 15645, strictPort: true },
  }),
);
