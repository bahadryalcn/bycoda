import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const mock = fileURLToPath(new URL("./assistant-room-mocks.tsx", import.meta.url));
const controls = fileURLToPath(new URL("./assistant-setup-controls-mocks.ts", import.meta.url));
export default defineConfig({
  optimizeDeps: { entries: ["tests/browser/assistant/assistant-room.html"] },
  plugins: [
    react(),
    {
      name: "bounded-assistant-fixture-css",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/styles/index.css"))
          return code
            .replace(
              '@import "tailwindcss" source("..");',
              '@import "tailwindcss" source(none);\n@source "../shared/ui";\n@source "../features/assistant";\n@source "../features/voice";\n@source "../features/sessions/ui";\n@source "../features/tasks/ui/AssistantTaskBadge.tsx";\n@source "../features/settings/ui/ShortcutSettings.tsx";',
            )
            .replaceAll(/@source "\.\.\/\.\.\/node_modules[^;]+;/g, "");
      },
    },
    tailwindcss(),
  ],
  resolve: {
    alias: [
      ...[
        "localVoiceClient",
        "localVoice",
        "realtimeVoiceClient",
        "realtimeVoice",
        "voicePreview",
      ].map((name) => ({ find: new RegExp(`(?:.*\\/)${name}$`), replacement: controls })),
      ...[
        "hostFeatureClient",
        "ModelPicker",
        "VoiceSetupSteps",
        "assistantBriefingSpeech",
        "assistantHostRead",
        "assistantSessionDetach",
      ].map((name) => ({ find: new RegExp(`(?:.*\\/)${name}$`), replacement: mock })),
    ],
  },
  build: {
    outDir: "temp/build/assistant-room",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/assistant/assistant-room.html"] },
  },
  server: { host: "127.0.0.1", port: 15632, strictPort: true },
  preview: { host: "127.0.0.1", port: 15632, strictPort: true },
});
