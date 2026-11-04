import { mergeConfig } from "vite";
import base from "./vite.assistant-room.config.ts";
export default mergeConfig(base, { build: { outDir: "temp/local/room-remote-preview/build", emptyOutDir: false }, server: { port: 15647 }, preview: { port: 15647, strictPort: true } });
