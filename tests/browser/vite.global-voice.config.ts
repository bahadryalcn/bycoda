import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "./vite.voice-visual-styles.config";

const mock = fileURLToPath(new URL("./voice-visual-styles-mocks.ts", import.meta.url));
export default mergeConfig(base, {
  resolve: {
    alias: ["voiceAssistant", "voiceToolClient"].map((name) => ({
      find: new RegExp(`(?:.*\\/)${name}$`),
      replacement: mock,
    })),
  },
  build: { outDir: "temp/build/global-voice" },
  server: { host: "127.0.0.1", port: 1498, strictPort: true },
  preview: { host: "127.0.0.1", port: 1498, strictPort: true },
});
