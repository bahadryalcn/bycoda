import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const mock = fileURLToPath(new URL("./voice-visual-styles-mocks.ts", import.meta.url));
export default defineConfig({
  plugins: [
    react(),
    {
      name: "bounded-voice-fixture-css",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/styles/index.css"))
          return code
            .replace(
              '@import "tailwindcss";',
              '@import "tailwindcss" source(none);\n@source "../shared/ui";\n@source "../features/voice";\n@source "../features/assistant";\n@source "../features/sessions/ui/QuestionForm.tsx";',
            )
            .replaceAll(/@source "\.\.\/\.\.\/node_modules[^;]+;/g, "");
      },
    },
    tailwindcss(),
  ],
  resolve: {
    alias: [
      "localVoice",
      "localVoiceClient",
      "voiceConversation",
      "voiceAssistant",
      "sessionsStore",
      "assistantClient",
      "voiceHistoryTransport",
      "assistantHostRead",
    ].map((name) => ({
      find: new RegExp(`(?:.*\\/)${name}$`),
      replacement: mock,
    })),
  },
  build: {
    outDir: "temp/build/voice-visual-styles",
    emptyOutDir: false,
    rolldownOptions: {
      input: [
        "tests/browser/voice-visual-styles.html",
        "tests/browser/voice-overlay.html",
        "tests/browser/voice-native-menu.html",
      ],
    },
  },
  server: { host: "127.0.0.1", port: 1497, strictPort: true },
  preview: { host: "127.0.0.1", port: 1497, strictPort: true },
});
