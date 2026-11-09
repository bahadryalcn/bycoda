import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import voice from "./vite.voice-visual-styles.config.ts";

const mock = fileURLToPath(new URL("./dictation-permissions-mocks.ts", import.meta.url));
export default defineConfig({
  ...voice,
  resolve: {
    alias: [
      { find: /(?:.*\/)localVoiceClient$/, replacement: mock },
      { find: /(?:.*\/)localVoice$/, replacement: mock },
      ...((voice.resolve?.alias ?? []) as { find: RegExp; replacement: string }[]),
    ],
  },
  build: {
    outDir: "temp/build/dictation-permissions",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/dictation-permissions.html"] },
  },
  server: { host: "127.0.0.1", port: 1513, strictPort: true },
  preview: { host: "127.0.0.1", port: 1513, strictPort: true },
});
