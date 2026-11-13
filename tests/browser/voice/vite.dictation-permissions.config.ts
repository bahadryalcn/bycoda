import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import voice from "./vite.voice-visual-styles.config.ts";

const mock = fileURLToPath(new URL("./dictation-permissions-mocks.ts", import.meta.url));
export default defineConfig({
  ...voice,
  plugins: [
    ...(voice.plugins ?? []),
    {
      name: "dictation-settings-data-boundary",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer?.replaceAll("\\", "/").endsWith("/DictationDictionarySettings.tsx") &&
          /\/(?:recents|projectNames)$/.test(source)
        )
          return mock;
        if (
          importer?.replaceAll("\\", "/").endsWith("/DictationCleanupSettings.tsx") &&
          source.endsWith("/modelHooks")
        )
          return mock;
      },
    },
  ],
  resolve: {
    alias: [
      ...["localDictationModels"].map((name) => ({
        find: new RegExp(`(?:.*\\/)${name}$`),
        replacement: mock,
      })),
      { find: /(?:.*\/)localVoiceClient$/, replacement: mock },
      { find: /(?:.*\/)localVoice$/, replacement: mock },
      ...((voice.resolve?.alias ?? []) as { find: RegExp; replacement: string }[]),
    ],
  },
  build: {
    outDir: "temp/build/dictation-permissions",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/voice/dictation-permissions.html"] },
  },
  server: { host: "127.0.0.1", port: 1513, strictPort: true },
  preview: { host: "127.0.0.1", port: 1513, strictPort: true },
});
